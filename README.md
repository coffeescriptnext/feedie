Feedie
======

Feedie is the feed import and processing system for [Siftie](https://siftie.com)
([code](https://github.com/nicksergeant/siftie)).

Siftie communicates to Feedie via REST API for new feed additions.

Install
-------

1. `npm install`
2. Grep both Siftie and Feedie repos for `<feed-key>`, and set that to
   something unique (and the same).
3. Change credentials in `< ... >` brackets in `index.js`.

Import and process feeds
------------------------

- `make feeds`

Once Feedie is installed on your server, you probably want to put `make feeds`
on cron.

Deploy
------

1. `git remote add dokku dokku@<your-dokku-server>:feedie`
2. `git push dokku`
