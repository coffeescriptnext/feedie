deploy:
	@git push heroku

feeds:
	@node --harmony index crawl-all

prune:
	@node --harmony index prune

.PHONY: deploy feeds prune
