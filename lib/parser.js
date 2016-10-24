'use strict';

let request = require('request');
let Iconv = require('iconv').Iconv;
let FeedParser = require('feedparser');
let Promise = require('bluebird');
let zlib = require('zlib');

function getParams(str) {
  let params = str.split(';').reduce(function(params, param) {
    let parts = param.split('=').map(function(part) { return part.trim(); });
    if (parts.length === 2) {
      params[parts[0]] = parts[1];
    }
    return params;
  }, {});
  return params;
}

function maybeDecompress(res, encoding) {
  var decompress;
  if (encoding.match(/\bdeflate\b/)) {
    decompress = zlib.createInflate();
  } else if (encoding.match(/\bgzip\b/)) {
    decompress = zlib.createGunzip();
  }
  return decompress ? res.pipe(decompress) : res;
}

function maybeTranslate(res, charset, reject) {
  let iconv;
  if (!iconv && charset && !/utf-*8/i.test(charset)) {
    try {
      iconv = new Iconv(charset, 'utf-8');
      console.log('Converting from charset %s to utf-8', charset);
      iconv.on('error', function(error) { reject(error); });
      res = res.pipe(iconv);
    } catch(err) {
      res.emit('error', err);
    }
  }
  return res;
}

function fetch(feed) {
  return new Promise(function(resolve, reject) {
    let items = [];
    let feedparser = new FeedParser();
    let req = request(feed, { timeout: 10000, pool: false });

    req.setMaxListeners(50);
    req.setHeader('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.63 Safari/537.36');

    req.on('error', function(error) { reject(error); });
    req.on('response', function(res) {
      if (res.statusCode != 200) return this.emit('error', new Error('Bad status code'));
      let encoding = res.headers['content-encoding'] || 'identity';
      let charset = getParams(res.headers['content-type'] || '').charset;
      res = maybeDecompress(res, encoding);
      res = maybeTranslate(res, charset, reject);
      res.pipe(feedparser);
    });

    feedparser.on('error', function(error) { reject(error); });
    feedparser.on('end', function() { resolve(items); });
    feedparser.on('readable', function() {
      let item; /* jshint -W084 */
      while (item = this.read()) { items.push(item); }
    });
  });
}

module.exports = {
  fetch: fetch
};
