function getOpts(argv) {
	var opts = {
		configFile:	"",
		createWindows:	true,
		bringUp:	true,
		takeDown:	false,
		closeWindows:	false,
		defOrder:	50,
	};

	for (var argN = 0; argN < argv.length; argN++) {
		console.log("arg " + argv[argN]);
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
		} else {
			opts.configFile		= argv[argN]
		}
	}
	if (opts.configFile == "") {
		console.log("Need config-file arg")
		return 3
	}
	return opts
}

function getConfig(filename) {
	console.log("config-file " + filename)
	const configFileContents = $.NSString.stringWithContentsOfFile(filename).js || "[]"
	return JSON.parse(configFileContents)
}

function inheritFrom(parentNode, childNode) {
	var keys = ['start_command', 'stop_command', 'debug']
	for (var i in keys) {
		var key = keys[i]
		if (parentNode[key] === undefined) {
			if      (key == "start_command") { parentNode[key] = "make run" }
			else if (key == "stop_command")  { parentNode[key] = "\003" }
		}
		if (childNode[key] === undefined && parentNode[key] !== undefined) {
			console.log("inherit " + key + " found");
			childNode[key] = parentNode[key]
		}
	}
}

function popConfig(config, opts) {
	// cascade config down to panes, get order

	// ascertain order: 1..(2*defOrder)+1 when bringUp, (-(2*defOrder+1)..-1 when takeDown)
	// in the config file the "order" is relative (-50..50), assumed 0
	var order = [];

	var winList = config.windows
	for (var w = 0; w < winList.length; w++) {
		inheritFrom(config, winList[w])

		var tabList = winList[w].tabs;
		for (var t = 0; t < tabList.length; t++) {
			inheritFrom(winList[w], tabList[t])

			var panesList = tabList[t].panes;
			for (var p = 0; p < panesList.length; p++) {
				inheritFrom(tabList[t], panesList[p])

				if (panesList[p].priority === undefined) {
					panesList[p].priority = 0
				} else if (panesList[p].priority < -opts.defOrder || panesList[p].priority > opts.defOrder) {
					console.log("Order value " + panesList[p].priority + " not in expected [-" + opts.defOrder + "," + opts.defOrder + "] range")
					return 4
				}

				var realOrder = opts.defOrder + panesList[p].priority + 1

				if (opts.takeDown     && !order.includes(-realOrder))	{ order.push(-realOrder) }
				if (opts.bringUp      && !order.includes(realOrder))	{ order.push(realOrder)  }
				if (opts.closeWindows && !order.includes(0))		{ order.push(0)		 }

			}
		}
	}
	order.sort(function(a, b){return b-a});
	console.log("Order: " + order + "\nopts: " + JSON.stringify(opts));
	return order
}

function run(argv) {
	var opts = getOpts(argv)
	const config = getConfig(opts.configFile)
	var cmdPrefix = " "
	var order = popConfig(config, opts)
	var winList = config.windows

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

		if (orderIdx > 0) {
			delay(opts.closeWindows ? 1 : 7);	// sleep
		}

		// iterate over windows
		for (var w = winFirst; w != winStop; w+=winIncr) {

			var winName = winList[w].name
			if (winName === undefined) {
				console.log("Cannot find name for window with index: " + w)
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
					// console.log("find window " + winName + " - got " + iTerm.windows[scanWinNum].name() + " var " + winNameVal)
					if (winNameVal == winName) {
						win = iTerm.windows[scanWinNum]
						break
					}
				}
				if (win === undefined) {
					console.log("Cannot find window " + winName)
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
					console.log("Cannot find name for tab with index: " + t + " within window: " + tabName)
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
						console.log("196 [" + (order[orderIdx]-opts.defOrder-1) + "] w " + w + " tab " + t + "  want "+tabName + "  got "+tabNameVal);
						if (tabNameVal == tabName) {
							tab = win.tabs[tabNum]
							gotTab = true
							break
						}
					}
					if (!gotTab) {
						console.log("Cannot find tab " + tabName)
						return 2
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
				// console.log("p1st " + pFirst + " pStop " + pStop + " pInc " + pIncr);

				// initialise the right number of rows (default) or columns (if startsNextColumn used then we preferTallOverWide i.e. columns)
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
						// console.log("win " + w + " tab " + t + " p1 " + p + " tab " + t + " rorc " + rowOrCol + ' new split');
					}
				}

				// create the sessions, creating columns within the existing rows, as needed
				for (var p = pFirst; p != pStop; p+=pIncr) {
					console.log("248 [" + (order[orderIdx]-opts.defOrder-1) + "] w " + w + "  tab " + t + "  p2 " + p + "  sess " + sessionIndex + " real opts: " + JSON.stringify(panesList[p]));
					var paneName = panesList[p].name;
					if (paneName === undefined) {
						console.log("251 Cannot find name for pane with index: " + t + " within window: " + paneName + " in tab: " + tabName)
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
								// console.log("win271 " + w + " p " + p + " tab " + t + " sess " + sessionIndex + ' new pane');
								// setBadge(win.tabs[t].sessions[sessionIndex], paneName)
							}
							sessionIndex++
						}

						// console.log("win277 " + w + " p " + p + " tab " + t + " sess " + sessionIndex);
						setVar(tab.sessions[sessionIndex], "sessName", paneName)
						setBadge(win.tabs[t].sessions[sessionIndex], paneName)
						win.tabs[t].sessions[sessionIndex].name = paneName;
						sendKeys(win, t, sessionIndex, "\014");

					} else {
						// find session/pane in this tab
						var gotPane = false
						for (sessionIndex = 0; sessionIndex < tab.sessions.length; sessionIndex++) {
							var sessNameVal = getVar(tab.sessions[sessionIndex], "sessName")
							if (sessNameVal == paneName) {
								gotPane = true
								break
							}
						}
						if (!gotPane) {
							console.log("Cannot find pane " + paneName)
							return 2
						}
					}

					var realOrder = opts.defOrder + panesList[p].priority + 1

					if (opts.takeDown && order[orderIdx] == -realOrder) {
						// sendLine(win, t, sessionIndex, cmdPrefix + "g_warn DOWN[" + panesList[p].priority + "] " + panesList[p].stop_command);
						// sendLine(win, t, sessionIndex, cmdPrefix + "echo dp services stop " + paneName + " [" + panesList[p].priority + "] " + panesList[p].stop_command);
						sendKeys(win, t, sessionIndex, "\003");
					}

					if (opts.bringUp && order[orderIdx] == realOrder) {
						sendLine(win, t, sessionIndex, cmdPrefix + "echo " + paneName + " [" + panesList[p].priority + "] " + panesList[p].start_command);
						sendLine(win, t, sessionIndex, cmdPrefix + "sleep 30");
					}

					if (opts.closeWindows && order[orderIdx] == 0) {
						sendKeys(win, t, sessionIndex, "\004");
					}

				}
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
	// console.log("send tab " + tabIndex + " sess " + sessionIndex);
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
