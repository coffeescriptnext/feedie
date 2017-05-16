'use strict';

const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const Promise = require('bluebird');
const _ = require('lodash');
const fetch = require('./lib/parser').fetch;
const http = require('http');
const imageSize = require('image-size');
const jsdom = require('jsdom');
const md5 = require('MD5');
const os = require('os');
const raven = require('raven');
const request = require('request');
const sanitizeHtml = require('sanitize-html');

const hostname = os.hostname();
const isProd = hostname !== 'pro.local';

const adminUrl = isProd ? 'http://siftie.com/admin/feeds/' : 'http://localhost:3000/admin/feeds/';

const sentryId = process.env.SENTRY_ID;
const sentryKey = process.env.SENTRY_KEY;
const sentryPass = process.env.SENTRY_PASS;

const sentry = new raven.Client(`https://${sentryKey}:${sentryPass}@app.getsentry.com/${sentryId}`);

sentry.patchGlobal();

process.on('uncaughtException', (err) => {
  process.stderr.write(`Caught exception: ${err}`);
});

process.on('exit', (err) => {
  process.stderr.write(`Caught exit: ${err}`);
});

process.on('SIGINT', (err) => {
  process.stderr.write(`Caught SIGINT: ${err}`);
});

let isServer;
let mongoUri;

if (isProd) {
  mongoUri = process.env.MONGODB_URI;
} else {
  mongoUri = 'mongodb://localhost:3001/meteor';
}

MongoClient.connect(mongoUri, function(error, db) {
  const crawl = function(feedId) {
    process.stdout.write('\n' + Date() + '\n---------------------------------------\n');

    if (error) throw new Error(error);

    const createFeedItems = function(feedId) {
      return new Promise(function(resolve, reject) {
        db.collection('feedItems')
          .insert({ _id: feedId, items: [] }, function(err, feedItems) {
            if (error) throw new Error(error);
            resolve(feedItems);
          });
      });
    };
    const feedItemsForFeed = function(feedId) {
      return new Promise(function(resolve, reject) {
        db.collection('feedItems')
          .findOne({ _id: feedId }, function(err, feedItems) {
            if (error) throw new Error(error);
            if (!feedItems) {
              return resolve(createFeedItems(feedId));
            } else {
              resolve(feedItems);
            }
          });
      });
    };
    const feedsPromise = new Promise(function(resolve, reject) {
      db.collection('feeds').find({})
        .toArray(function(error, feeds) {
          if (error) throw new Error(error);
          resolve(feeds);
        });
    });
    // const processImages = function(item) {
    //   process.stdout.write('- Processing images for ' + item.link + '.\n');
    //   return new Promise(function(resolveProcessImages, rejectProcessImages) {
    //     if (!item.description) return resolveProcessImages();
    //     jsdom.env(item.description, ['http://code.jquery.com/jquery.js'], function (e, window) {
    //       const $ = window.$;
    //       const imagePromises = [];

    //       if ($) {
    //         const images = $('img');

    //         $.each(images, function(index) {

    //           const img = images.eq(index);
    //           const imgUrl = img.attr('src');

    //           imagePromises.push(new Promise(function(resolveImage, rejectImage) {

    //             request.get({
    //                 url: imgUrl,
    //                 encoding: null
    //             }, function (e, response, buffer) {

    //               let badFileType = false;
    //               let size = {};
    //               try {
    //                 size = imageSize(buffer);
    //               } catch (e) {
    //                 badFileType = true;
    //               }

    //               if (size.width < 250 || badFileType) {
    //                 $('img[src="' + imgUrl + '"]').remove();
    //               } else if (size.width >= 500 && !item.featuredImage) {
    //                 $('img[src="' + imgUrl + '"]').remove();
    //                 item.featuredImage = imgUrl;
    //               } else {
    //                 item.images = item.images || [];
    //                 item.images.push(imgUrl);
    //                 $('img[src="' + imgUrl + '"]').wrap('<div class="img-container">');
    //               }

    //               resolveImage();
    //             });


    //           }));
    //         });
    //       }

    //       Promise.all(imagePromises).then(function() {
    //         if ($) {
    //           item.description = $('body').html();
    //         } else {
    //           item.description = '';
    //         }
    //         process.stdout.write('- Done with images for ' + item.link + '.\n');
    //         resolveProcessImages();
    //       });
    //     });
    //   });
    // };
    const updateFeedError = function(feedResult) {
      return new Promise(function(resolve, reject) {
        db.collection('feeds')
          .update(
            { _id: feedResult.feed._id },
            { $set: { error: feedResult.error.message }},
            function(err, feed) {
              if (err) return reject(err);
              resolve(feed);
            });
      });
    };
    const updateFeedSuccess = function(feedResult) {
      return new Promise(function(resolve, reject) {
        db.collection('feeds')
          .update(
            { _id: feedResult.feed._id },
            { $unset: { error: "" }},
            function(err, feed) {});
        feedItemsForFeed(feedResult.feed._id).then(function(feedItems) {

          const items = feedResult.items.map(function(item) {
            item.potentialHashes = [
              md5(feedResult.feed._id + item.link),
              md5(feedResult.feed._id + item.title)
            ];
            return item;
          });

          let newItems = items.filter(function(item) {
            const alreadyExists = !!_.intersection(feedItems.items || [], item.potentialHashes).length;
            if (!alreadyExists) {
              item.id = item.potentialHashes[0];
            }
            return !alreadyExists;
          });

          const imagePromises = [];

          newItems = newItems.map(function(item) {

            let newItem = {
              id: item.id,
              potentialHashes: item.potentialHashes,
              feedId: feedResult.feed._id,
              feedTitle: item.meta.title,
              link: item.link,
              created: new Date(),
              pubDate: item.pubDate || new Date(),
              title: item.title,
              preview: item.description ? sanitizeHtml(item.description.replace(/\&nbsp\;/, ''), {
                allowedTags: []
              }).substr(0, 120).trim() : null,
              description: item.description ? sanitizeHtml(item.description.replace(/\&nbsp\;/, ''), {
                allowedTags: ['a', 'p', 'img']
              }) : null
            };

            // imagePromises.push(processImages(newItem));

            return newItem;
          });

          if (!newItems.length) return resolve();

          Promise.all(imagePromises).then(function() {
            // process.stdout.write('Done with images.\n');
            process.stdout.write('Inserting items.\n');
            db.collection('items').insert(newItems, function(itemsErr, rawItems) {
              if (itemsErr) {
                process.stdout.write(itemsErr + '\n');
                return reject(itemsErr);
              }
              if (!rawItems.length) return resolve();
              process.stdout.write('Done with items.\n');
              process.stdout.write('Inserting feedItems.\n');
              db.collection('feedItems').update({ _id: feedResult.feed._id },
                { $pushAll: { items: _.flatten(_.pluck(newItems, 'potentialHashes')) }},
                function(feedItemsErr, feed) {
                  if (feedItemsErr) {
                    process.stdout.write(feedItemsErr + '\n');
                    return reject(feedItemsErr);
                  }
                  process.stdout.write('Done with feedItems.\n');
                  resolve(feed);
                }
              );
            });
          });
        });
      });
    };

    feedsPromise.then(function(rawFeeds) {

      const activeFeeds = rawFeeds.filter(function(rawFeed) {
        if (feedId) {
          return rawFeed._id === feedId;
        } else {
          // TODO: Exclude feeds that are not subscribed to by any channels.
          // return !feed.error;
          return true;
        }
      });

      const fetches = Promise.all(
        activeFeeds.map(function(feed) {
          return fetch(feed.url).then(function(items) {
            process.stdout.write('[Success] ' + feed.url + '\n - ' + adminUrl + feed._id + '\n');
            return { feed: feed, items: items };
          }).catch(function(error) {
            process.stdout.write('[Error] ' + feed.url + '\n - ' + adminUrl + feed._id + '\n');
            return { feed: feed, error: error };
          });
        })
      );

      fetches.then(function(feeds) {

        const badFeeds = feeds.filter(function(f) { return f.error; });
        const goodFeeds = feeds.filter(function(f) { return !f.error; });

        process.stdout.write('\n' + badFeeds.length + ' bad feeds.' + '\n');
        process.stdout.write(goodFeeds.length + ' good feeds.' + '\n');

        return Promise.all(
          feeds.map(function(feed) {
            return feed.error ? updateFeedError(feed) : updateFeedSuccess(feed);
          })
        );

      }).then(function() {
        process.stdout.write('Done with feeds.\n');

        if (!isServer) {
          process.stdout.write('Exiting. (1)\n');
          process.exit();
        }
      }).catch(function(error) {
        throw new Error(error);
      });

    });
  };

  const prune = function() {
    // Get all items published longer than 4 months ago.
    const itemsPromise = new Promise(function(resolve, reject) {
      const d = new Date();
      const sinceDate = d.setDate(d.getDate() - 120);
      db.collection('items').find({
        'pubDate': {
          $lte: new Date(sinceDate)
        }
      }, { _id: 1 }).toArray(function(error, items) {
        if (error) throw new Error(error);
        resolve(items);
      });
    });

    // Get all teamItems.
    itemsPromise.then(function(items) {
      return new Promise(function(resolve, reject) {
        db.collection('teamItems').find({}, { itemId: 1 }).toArray(function(error, teamItems) {
          if (error) throw new Error(error);
          resolve({ items: items, teamItems: teamItems });
        });
      });

    }).then(function(result) {

      // Cast teamItem IDs to strings for comparison.
      const teamItemIds = _.map(result.teamItems, function(teamItem) {
        return teamItem.itemId.toString();
      });

      // Find all items that have no matching teamItem.
      const itemsWithoutTeamItems = result.items.filter(function(item) {
        return !_.includes(teamItemIds, item._id.toString());
      });

      // Extract IDs of those items.
      const itemsWithoutTeamItemsIds = _.pluck(itemsWithoutTeamItems, '_id');

      process.stdout.write('Removing ' + itemsWithoutTeamItems.length + ' items...\n');

      // Remove all items that have no matching teamItem.
      return new Promise(function(resolve, reject) {
        db.collection('items').remove({ _id: { $in: itemsWithoutTeamItemsIds }}, function(error, result) {
          if (error) throw new Error(error);
          process.stdout.write('  ...Done.\n');
          resolve(itemsWithoutTeamItemsIds);
        });
      });

    }).then(function(itemsWithoutTeamItemsIds) {

      // Cast item IDs to strings for comparison w/ itemsRead (they're stored as strings there).
      const itemsWithoutTeamItemsIdsStr = itemsWithoutTeamItemsIds.map(function(i) {
        return i.toString();
      });

      return new Promise(function(resolve, reject) {

        // Get all users who have an item that was removed in their itemsRead.
        db.collection('users').find({
          'profile.itemsRead': {
            $in: itemsWithoutTeamItemsIdsStr
          }
        }).toArray(function(error, users) {

          if (error) throw new Error(error);

          const promises = [];

          // For each user, remove any items that were removed from their itemsRead.
          users.forEach(function(user) {
            promises.push(new Promise(function(resolveUser, rejectUser) {
              db.collection('users').update({ _id: user._id }, {
                $pullAll: {
                  'profile.itemsRead': itemsWithoutTeamItemsIdsStr
                }
              }, function(error) {
                if (error) throw new Error(error);
                process.stdout.write('- Removed items from ' + user.emails[0].address + '\'s itemsRead.\n');
                resolveUser();
              });
            }));
          });

          return Promise.all(promises).then(function() {
            resolve();
          });
        });
      }).then(function() {
        process.stdout.write('Done with feeds.\n');

        if (!isServer) {
          process.stdout.write('Exiting. (2)\n');
          process.exit();
        }
      }).catch(function(error) {
        throw new Error(error);
      });
    });
  };

  switch(process.argv[2]) {
    case 'server':
      isServer = true;

      var server = http.createServer(function (request, response) {
        response.writeHead(200, {'Content-Type': 'text/plain'});

        const urlParts = request.url.split('/');

        if (urlParts[1] !== process.env.FEEDIE_KEY) {
          response.end('');
          return;
        }
        
        if (urlParts.length === 4 && urlParts[2] === 'crawl') {
          response.end('crawling ' + urlParts[3]);
          crawl(urlParts[3]);
          return;
        }
        
        if (urlParts.length === 3 && urlParts[2] === 'crawl-all') {
          response.end('crawling all');
          crawl();
          return;
        }
        
        if (urlParts.length === 3 && urlParts[2] === 'prune') {
          response.end('pruning');
          prune();
          return;
        }

        response.end('alive');
        return;
      });

      server.listen(process.env.PORT || 3838);
    break;
    case 'crawl-all':
      crawl();
    break;
    case 'crawl-single':
      crawl(process.argv[3]);
    break;
    case 'prune':
      prune();
    break;
  }
});
