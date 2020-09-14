# itermaton

Itermaton provides some automation for [iTerm2](https://iterm2.com/) windows.

By default, Itermaton will create panes (and their parent tabs and windows) and 'type' start commands into each.

There are also options: `--stop`, `--restart` and `--close`.
The panes are started (or stopped) in order of priority (reversed when stopping).

iTerm badges are supported.

:warning: Very much in alpha at the moment.

## Setup

In iTerm, create a new profile that allows tabs (assuming you intend to use this feature):

1. open *Profiles*

1. *Edit Profiles...*

1. Click the plus-sign :heavy_plus_sign: in the bottom left

  - change the profile name to `itermaton`
  - select the *Window* tab for this new profile
  - de-select the "Force this profile to always open in a new window [...]" option

## Usage

The `Makefile` in this repo contains a command to run itermaton with the supplied sample configuration.

  `$ make`

This should open two windows, with some tabs, each with several panes in them. Then it should "start the apps" in each (though `debug` is on, in the sample config file, so it will merely `echo` some info in each pane).
