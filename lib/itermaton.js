function getOpts(argv) {
	var opts = {
		configFile:	"",
		createWindows:	true,
		bringUp:	true,
		takeDown:	false,
		closeWindows:	false,
		defOrder:	50,
		logLevel:	0,
	};

	for (var argN = 0; argN < argv.length; argN++) {
		logAt(1, opts, "arg " + argv[argN]);
		if (argv[argN] == "--stop") {
			opts.takeDown		= true
			opts.bringUp		= false
			opts.createWindows	= false
		} else if (argv[argN] == "--restart") {
			opts.takeDown		= true
			opts.createWindows	= false
		} else if (argv[argN] == "--start") {
			opts.createWindows	= false
		} else if (argv[argN] == "--open") {
			opts.bringUp		= false
		} else if (argv[argN] == "--close") {
			opts.createWindows	= false
			opts.bringUp		= false
			opts.closeWindows	= true
		} else if (argv[argN] == "-v") {
			opts.logLevel++
		} else {
			opts.configFile		= argv[argN]
		}
	}
	if (opts.configFile == "") {
		logAt(0, opts, "Need config-file arg")
		return 3
	}
	return opts
}

function logAt() {
	if (arguments.length < 3) { return; }
	var lev  = arguments[0]
	var opts = arguments[1]
	if (opts.logLevel < lev) { return; }
	var args = []
	for (var arg = 2; arg < arguments.length; arg++) { args.push(arguments[arg]); }
	console.log(args)
}

function getConfig(filename, opts) {
	logAt(1, opts, "config-file " + filename)
	const configFileContents = $.NSString.stringWithContentsOfFile(filename).js || "[]"
	return JSON.parse(configFileContents)
}

function inheritFrom(parentNode, childNode, opts) {
	var keys = ['init_commands', 'late_init_commands', 'start_command', 'stop_command', 'stop_is_sigint', 'priority', 'debug']
	for (var key of keys) {

		// initialise parent
		if (parentNode[key] === undefined) {
			if        (key == "start_command")  { parentNode[key] = "make run"
			} else if (key == "stop_command")   { parentNode[key] = ""
			} else if (key == "stop_is_sigint") { parentNode[key] = true
			} else if (key == "priority")       { parentNode[key] = 0
			} else if (key == "init_commands" ||
				   key == "late_init_commands") { parentNode[key] = []
			}
		}

		// update child
		if (key == "init_commands" || key == "late_init_commands") {
			if (childNode[key] === undefined) {
				childNode[key] = []
			}
			logAt(2, opts, "inherit " + key + " '" + parentNode[key] + "'")
			childNode[key] = parentNode[key].concat(childNode[key])

		} else if (childNode[key] === undefined && parentNode[key] !== undefined) {
			logAt(2, opts, "inherit '" + key + "'");
			childNode[key] = parentNode[key]
		}
	}
}

function populateConfig(config, opts) {
	// cascade config down to panes, get order

	// ascertain order: 1..(2*opts.defOrder)+1 when bringUp, (-(2*opts.defOrder+1)..-1 when takeDown)
	// in the config file the "order" is relative (-50..50), assumed 0
	var order	= [];
	var downOrder	= [];

	var winList = config.windows
	for (var w = 0; w < winList.length; w++) {
		inheritFrom(config, winList[w], opts)

		var tabList = winList[w].tabs;
		for (var t = 0; t < tabList.length; t++) {
			inheritFrom(winList[w], tabList[t], opts)

			var panesList = tabList[t].panes;
			for (var p = 0; p < panesList.length; p++) {
				inheritFrom(tabList[t], panesList[p], opts)

				if (panesList[p].priority < -opts.defOrder || panesList[p].priority > opts.defOrder) {
					logAt(0, opts, "Order value " + panesList[p].priority + " not in expected [-" + opts.defOrder + "," + opts.defOrder + "] range")
					return 4
				}
				var realOrder = opts.defOrder + panesList[p].priority + 1	// -50,50 => 1,101

				if (opts.takeDown     && !downOrder.includes(-realOrder))	{ downOrder.push(-realOrder)	}
				if (opts.bringUp      && !order.includes(realOrder))		{ order.push(realOrder)		}
				if (opts.closeWindows && !order.includes(0))			{ order.push(0)			}

			}
		}
	}
	order.sort(function(a, b){return b-a});
	if (downOrder.length > 0) {
		downOrder.sort(function(a, b){return b-a});
		order = downOrder.concat(order);
	}
	logAt(1, opts, "Order: " + order + "\nopts: " + JSON.stringify(opts));
	return order
}

function run(argv) {
	var opts = getOpts(argv)
	const config    = getConfig(opts.configFile, opts)
	var   order     = populateConfig(config, opts)
	var   winList   = config.windows
	var   cmdPrefix = " "

	// get iterm, on which to work
	var iTerm = Application('iTerm2')
	iTerm.includeStandardAdditions = true;

	var winFirst = 0, winStop = winList.length, winIncr = 1;
	if (opts.closeWindows) {
		// closing windows? do it in reverse order of windows
		winFirst = winList.length-1; winStop = -1; winIncr = -1;
	}


	////////////
	// main loop		inner loops act on windows/tabs/panes matching order[orderIdx]
	////////////

	var lastOrder = 0
	for (var orderIdx = 0; orderIdx < order.length; orderIdx++) {

		normalisedOrder = Math.sign(order[orderIdx])*(Math.abs(order[orderIdx])-opts.defOrder-1);

		if (orderIdx > 0) {
			var sleepy = Math.abs(lastOrder-Math.abs(normalisedOrder));
			if (sleepy == 0) { sleepy = 20; }
			var origSleepy = sleepy
			if (config.debug || opts.closeWindows)  { sleepy = 2;  }
			logAt(1, opts, "Norm: " + normalisedOrder + "  Sleep: " + sleepy + " (" + origSleepy + ")  lastOrder: " + lastOrder);
			delay(sleepy);	// sleep
			lastOrder = Math.abs(normalisedOrder);
		}

		// iterate over windows
		for (var w = winFirst; w != winStop; w+=winIncr) {

			var winName = winList[w].name
			if (winName === undefined) {
				logAt(0, opts, "Cannot find name for window with index: " + w)
				return 2
			}

			var win;	// will be the window that we create or find
			if (opts.createWindows && orderIdx == 0) {
				// create window in this app
				if (config.profile !== undefined) {
					win = iTerm.createWindowWithProfile(config.profile);
				} else {
					win = iTerm.createWindowWithDefaultProfile();
				}

				setVar(win.tabs[0].sessions[0], "winName", winName)
				setTitle(win.currentSession, winName)
				// setBadge(win.currentSession, winName)

			} else {
				// find window in this app
				for (var scanWinNum = 0; scanWinNum < iTerm.windows.length; scanWinNum++) {
					var winNameVal = getVar(iTerm.windows[scanWinNum].tabs[0].sessions[0], "winName")
					// logAt(1, opts, "find window " + winName + " - got " + iTerm.windows[scanWinNum].name() + " var " + winNameVal)
					if (winNameVal == winName) {
						win = iTerm.windows[scanWinNum]
						break
					}
				}
				if (win === undefined) {
					logAt(0, opts, "Cannot find window " + winName)
					return 2
				}

			}

			// have window, now create/find tab, start with current (first in window)
			var tab = win.currentTab;
			var tabList = winList[w].tabs;

			// if closeWindows, do so in reverse order of tabs
			var tFirst = 0, tStop = tabList.length, tIncr = 1;
			if (opts.closeWindows) {
				tFirst = tabList.length-1; tStop = -1; tIncr = -1;
			}

			for (var t = tFirst; t != tStop; t+=tIncr) {

				var tabName = tabList[t].name
				if (tabName === undefined) {
					logAt(0, opts, "Cannot find name for tab with index: " + t + " within window: " + tabName)
					return 2
				}

				if (opts.createWindows && orderIdx == 0) {
					if (t > 0) {
						// create tab in this window
						if (config.profile !== undefined) {
							tab = win.createTab({withProfile: config.profile});
						} else {
							tab = win.createWithDefaultProfile();
						}
					}

					setVar(tab.sessions[0], "tabName", tabName)
					setTitle(tab.currentSession, tabName, true)
					// setBadge(tab.currentSession, tabName)

				} else {
					// find tab in this window
					var gotTab = false
					for (var tabNum = 0; tabNum < win.tabs.length; tabNum++) {
						var tabNameVal = getVar(win.tabs[tabNum].sessions[0], "tabName")
						logAt(2, opts, "230 [" + normalisedOrder + "] w " + w + " tab " + t + "  want "+tabName + "  got "+tabNameVal);
						if (tabNameVal == tabName) {
							tab = win.tabs[tabNum]
							gotTab = true
							break
						}
					}
					if (!gotTab) {
						logAt(0, opts, "Cannot find tab " + tabName)
						delay(5) // sleep
						continue
					}

				}

				var sessionIndex = 0;
				var preferTallOverWide = false
				var panesList = tabList[t].panes;

				// closeWindows in reverse order
				var pFirst = 0, pStop = panesList.length, pIncr = 1;
				if (opts.closeWindows) {
					pFirst = panesList.length-1; pStop = -1; pIncr = -1;
				}
				// logAt(1, opts, "p1st " + pFirst + " pStop " + pStop + " pInc " + pIncr);

				// initialise the right number of rows (default) or columns (if startsNextColumn used then we preferTallOverWide i.e. columns)
				if (opts.createWindows) {
					for (var p = pFirst, rowOrCol = 0; p != pStop; p+=pIncr) {
						var newRowOrCol = false
						if (panesList[p].startsNextColumn) {
							preferTallOverWide = true
							if (!opts.createWindows || orderIdx > 0) {
								break
							}
							win.tabs[t].sessions[rowOrCol].splitVerticallyWithSameProfile();
							rowOrCol++
							newRowOrCol = true
						} else if (panesList[p].startsNextRow) {
							if (!opts.createWindows || orderIdx > 0) {
								break
							}
							win.tabs[t].sessions[rowOrCol].splitHorizontallyWithSameProfile();
							rowOrCol++
							newRowOrCol = true
						}
						if (newRowOrCol) {
							// setBadge(win.tabs[t].sessions[rowOrCol-1], panesList[p].name)
							// logAt(1, opts, "win " + w + " tab " + t + " p1 " + p + " tab " + t + " rorc " + rowOrCol + ' new split');
						}
					}
				}

				// create/destroy the sessions, creating columns within the existing rows, as needed
				for (var p = pFirst; p != pStop; p+=pIncr) {
					logAt(2, opts, "283 [" + normalisedOrder + "] w " + w + "  tab " + t + "  p2 " + p + "  sess " + sessionIndex + " real opts: " + JSON.stringify(panesList[p]));
					var paneName = panesList[p].name;
					if (paneName === undefined) {
						logAt(0, opts, "285 Cannot find name for pane with index: " + t + " within window: " + paneName + " in tab: " + tabName)
						return 2
					}

					if (opts.createWindows && orderIdx == 0) {
						if (p > 0) {
							var newPane = false
							// create a new split for this non-first pane
							if (preferTallOverWide) {
								if (!panesList[p].startsNextColumn) {
									// new pane below
									win.tabs[t].sessions[sessionIndex].splitHorizontallyWithSameProfile();
									newPane = true
								}
							} else if (!panesList[p].startsNextRow) {
								// new pane right
								win.tabs[t].sessions[sessionIndex].splitVerticallyWithSameProfile();
								newPane = true
							}
							if (newPane) {
								// logAt(2, opts, "win271 " + w + " p " + p + " tab " + t + " sess " + sessionIndex + ' new pane');
								// setBadge(win.tabs[t].sessions[sessionIndex], paneName)
							}
							sessionIndex++
						}

						// logAt(2, opts, "win277 " + w + " p " + p + " tab " + t + " sess " + sessionIndex);
						setVar(tab.sessions[sessionIndex], "sessName", paneName)
						setBadge(win.tabs[t].sessions[sessionIndex], paneName)
						win.tabs[t].sessions[sessionIndex].name = paneName;
						sendKeys(win, t, sessionIndex, "\014");

					} else {
						// find session/pane in this tab
						var gotPane = false
						var sessFirst = 0, sessStop = tab.sessions.length, sessIncr = 1
						if (opts.closeWindows) {
						 	sessFirst = tab.sessions.length-1, sessStop = -1, sessIncr = -1
						}
						for (sessionIndex = sessFirst; sessionIndex != sessStop; sessionIndex+=sessIncr) {
							logAt(2, opts, w+" "+t+" "+p+ " top="+sessionIndex + " len="+tab.sessions.length+"  "+paneName)
							// race condition xref_close_race
							var sess = tab.sessions[sessionIndex]
							if (sess===undefined) {
								logAt(0, opts, w+" "+t+" "+p+" sess="+sessionIndex + " undef sess for " + paneName)
							}
							var sessNameVal = getVar(sess, "sessName")
							if (sessNameVal === undefined){
								logAt(0, opts, w+" "+t+" "+p+" sess="+sessionIndex + " undef NAME for " + paneName)
							}
							if (sessNameVal == paneName) {
								gotPane = true
								break
							}
							logAt(2, opts, w+" "+t+" "+p+" sess="+sessionIndex + "... " + paneName + " != " + sessNameVal)
						}
						logAt(2, opts, w+" "+t+" "+p+ " post")
						if (!gotPane) {
							logAt(0, opts, "Warning: Cannot find pane " + paneName)
							delay(5) // sleep
							continue
						}
					}
					logAt(2, opts, w+" "+t+" "+p+ " l=345  "+sessionIndex)

					var realOrder = opts.defOrder + panesList[p].priority + 1
					logAt(2, opts, w+" "+t+" "+p+ " l=348")

					if (opts.takeDown && order[orderIdx] == -realOrder) {
						if (panesList[p].stop_is_sigint) {
							sendKeys(win, t, sessionIndex, "\003");
							delay(0.5) // sleep
						}
						if (panesList[p].debug) {
							sendLine(win, t, sessionIndex, cmdPrefix + "echo $(date '+%Y-%m-%d %H:%M:%S') 'DOWN \"" + paneName +"\" [" + panesList[p].priority + "] \"" + panesList[p].stop_command + "\"'");
						} else {
							sendLine(win, t, sessionIndex, cmdPrefix + panesList[p].stop_command);
						}
					}
					logAt(2, opts, w+" "+t+" "+p+ " l=360")

					if (opts.bringUp && order[orderIdx] == realOrder) {
						for (var cmdN of panesList[p].init_commands) {
							sendLine(win, t, sessionIndex, cmdPrefix + cmdN)
						}
						for (var cmdN of panesList[p].late_init_commands) {
							sendLine(win, t, sessionIndex, cmdPrefix + cmdN)
						}
						if (panesList[p].debug) {
							sendLine(win, t, sessionIndex, cmdPrefix + "echo $(date '+%Y-%m-%d %H:%M:%S') 'UP   \"" + paneName + "\" [" + panesList[p].priority + "] \"" + panesList[p].start_command + "\"'");
						} else {
							sendLine(win, t, sessionIndex, cmdPrefix + panesList[p].start_command);
						}
					}
					logAt(2, opts, w+" "+t+" "+p+ " l=375")

					if (opts.closeWindows && order[orderIdx] == 0) {
						sendKeys(win, t, sessionIndex, "\004");
						delay(0.5) // sleep to allow window to close before moving to next (race condition xref_close_race)
					}
					logAt(2, opts, w+" "+t+" "+p+ " l=380")

				}
				logAt(2, opts, w+" "+t+" "+p+ " l=383")

			}
		}
	}
}

function setVar(sess, key, val) { sess.setVariable(    {named: "user."+key, to: val}); }
function getVar(sess, key)      { return sess.variable({named: "user."+key});          }

function setTitle(sess, newName, isTab){
	var oneForTab = isTab ? 1 : 2;
	sess.write({ text: ` echo -ne "\\033]`+oneForTab+`;`+newName+`\\007"` });
	// win.tabs[t].sessions[sessionIndex].name = newName
}
function setBadge(sess, newName){
	var badgeBase64 = Base64.encode(newName);
	sess.write({ text: ` echo -ne "\\033]1337;SetBadgeFormat=`+badgeBase64+`\\007"` });
}
function sendKeys(win, tabIndex, sessionIndex, message){
	win.tabs[tabIndex].sessions[sessionIndex].write({ text: message, newline: false });
}
function sendLine(win, tabIndex, sessionIndex, message){
	// logAt(1, opts, "send tab " + tabIndex + " sess " + sessionIndex);
	win.tabs[tabIndex].sessions[sessionIndex].write({ text: message });
}

var Base64 = { // partial copy from http://www.webtoolkit.info/
	// private property
	_keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

	// public method for encoding
	encode : function (input) {
		var output = "";
		var chr1, chr2, chr3, enc1, enc2, enc3, enc4;

		for (var i = 0; i < input.length;) {

			chr1 = input.charCodeAt(i++);
			chr2 = input.charCodeAt(i++);
			chr3 = input.charCodeAt(i++);

			enc1 = chr1 >> 2;
			enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
			enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
			enc4 = chr3 & 63;

			if (isNaN(chr2)) {
				enc3 = enc4 = 64;
			} else if (isNaN(chr3)) {
				enc4 = 64;
			}

			output = output +
				Base64._keyStr.charAt(enc1) +
				Base64._keyStr.charAt(enc2) +
				Base64._keyStr.charAt(enc3) +
				Base64._keyStr.charAt(enc4);

		}

		return output;
	},
}
