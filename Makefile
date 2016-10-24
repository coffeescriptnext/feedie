deploy:
	@git push dokku

feeds:
	@node --harmony index crawl-all

prune:
	@node --harmony prune

.PHONY: deploy feeds prune
