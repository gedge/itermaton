SHELL=bash

EG?=examples/itermaton-eg1.json
LIB?=lib/itermaton.js

all:
	osascript -l JavaScript $(LIB) $(EG)

restart:
	osascript -l JavaScript $(LIB) --restart $(EG)

edit:
	$(VISUAL) Makefile lib/*.js examples/*.json
