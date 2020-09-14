SHELL=bash

EG?=examples/itermaton-eg1.json
LIB?=lib/itermaton.js

all:
	osascript -l JavaScript $(LIB) $(EG)

restart stop close:
	osascript -l JavaScript $(LIB) --$@ $(EG)

edit:
	$(VISUAL) *.md Makefile lib/*.js examples/*.json
