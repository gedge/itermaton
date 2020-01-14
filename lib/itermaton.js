function run(argv) {
	var opts = {
		createWindows:	true,
		takeDown:	false,
		bringUp:	true,
		configFile:	"",
	};
	for (var argN = 0; argN < argv.length; argN++) {
		console.log("arg " + argv[argN]);
		if (argv[argN] == "--down") {
			opts.takeDown		= true
			opts.bringUp		= false
			opts.createWindows	= false
		} else if (argv[argN] == "--restart") {
			opts.takeDown		= true
			opts.createWindows	= false
		} else {
			opts.configFile		= argv[argN]
		}
	}
	if (opts.configFile == "") {
		console.log("Need config-file arg")
		return 3
	}

		console.log("config-file " + opts.configFile)
	const configFileContents = $.NSString.stringWithContentsOfFile(opts.configFile).js || "[]"
	const config = JSON.parse(configFileContents)
	var winList = config.windows

	var orderMax = 100;
	// ascertain order: 1..orderMax when bringUp, -orderMax..-1 created when takeDown, 50/-50 are the defaults)
	var order = [];
	for (var w = 0; w < winList.length; w++) {
		var tabList = winList[w].tabs;
		for (var t = 0; t < tabList.length; t++) {
			var panesList = tabList[t].panes;
			for (var p = 0; p < panesList.length; p++) {
				if (panesList[p].order === undefined) {
					panesList[p].order = 50
				}
				if (panesList[p].order < 1 || panesList[p].order > orderMax) {
					console.log("Order value " + panesList[p].order + " is outside expected [1," + orderMax + "] range")
					return 4
				}

				if (opts.takeDown && !order.includes(-panesList[p].order)) { order.push(-panesList[p].order) }
				if (opts.bringUp  && !order.includes(panesList[p].order))  { order.push(panesList[p].order)  }

			}
		}
	}
	order.sort(function(a, b){return a-b});
	console.log("Order: " + order + "\nopts: " + JSON.stringify(opts));

	// get the app to work on
	var iTerm = Application('iTerm2')
	iTerm.includeStandardAdditions = true;

	// now do the thing
	for (var orderIdx = 0; orderIdx < order.length; orderIdx++) {

		if (orderIdx > 0) {
			delay(7)
		}

		for (var w = 0; w < winList.length; w++) {

			var winName = winList[w].name
			if (winName === undefined) {
				console.log("Cannot find name for window with index: " + w)
				return 2
			}

			var win;
			if (opts.createWindows && orderIdx == 0) {
				// create window in this app
				if (config.profile !== undefined) {
					win = iTerm.createWindowWithProfile(config.profile);
				} else {
					win = iTerm.createWindowWithDefaultProfile();
				}

				setVar(win.tabs[0].sessions[0], "winName", winName)
				setTitle(win.currentSession, winName)

			} else {
				// find window in this app
				for (var winNum = 0; winNum < iTerm.windows.length; winNum++) {
					var winNameVal = getVar(iTerm.windows[winNum].tabs[0].sessions[0], "winName")
					// console.log("find window " + winName + " - got " + iTerm.windows[winNum].name() + " var " + winNameVal)
					if (winNameVal == winName) {
						win = iTerm.windows[winNum]
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

			for (var t = 0; t < tabList.length; t++) {

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

				} else {
					// find tab in this window
					var gotTab = false
					for (var tabNum = 0; tabNum < win.tabs.length; tabNum++) {
						var tabNameVal = getVar(win.tabs[tabNum].sessions[0], "tabName")
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

				// prepare the right number of rows or columns (if using startsNextColumn then we preferTallOverWide i.e. columns), first
				for (var p = 0, rowOrCol = 0; p < panesList.length; p++) {
					// console.log("win " + w + " tab " + t + " p " + p + " sess " + sessionIndex + " pre");
					if (panesList[p].startsNextColumn) {
						preferTallOverWide = true
						if (!opts.createWindows || orderIdx > 0) {
							break
						}
						win.tabs[t].sessions[rowOrCol].splitVerticallyWithSameProfile();
						rowOrCol++
					} else if (panesList[p].startsNextRow) {
						if (!opts.createWindows || orderIdx > 0) {
							break
						}
						win.tabs[t].sessions[rowOrCol].splitHorizontallyWithSameProfile();
						rowOrCol++
					}
				}

				// create the sessions, creating columns within the existing rows, as needed
				for (var p = 0; p < panesList.length; p++) {
					// console.log("win " + w + "  tab " + t + "  p " + p + "  sess " + sessionIndex + " real");
					var paneName = panesList[p].name;
					if (paneName === undefined) {
						console.log("Cannot find name for pane with index: " + t + " within window: " + paneName + " in tab: " + tabName)
						return 2
					}

					if (opts.createWindows && orderIdx == 0) {
						if (p > 0) {
							// create a new split for this non-first pane
							if (preferTallOverWide) {
								if (!panesList[p].startsNextColumn) {
									// new pane below
									win.tabs[t].sessions[sessionIndex].splitHorizontallyWithSameProfile();
								}
							} else if (!panesList[p].startsNextRow) {
								// new pane right
								win.tabs[t].sessions[sessionIndex].splitVerticallyWithSameProfile();
							}
							sessionIndex++
						}

						// console.log("win " + w + " p " + p + " tab " + t + " sess " + sessionIndex);
						setVar(tab.sessions[sessionIndex], "sessName", paneName)
						win.tabs[t].sessions[sessionIndex].name = paneName;
						sendLine(win, t, sessionIndex, ". dp-lib.sh && clear");

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

					if (opts.takeDown && order[orderIdx] == -panesList[p].order) {
						sendKeys(win, t, sessionIndex, "");
						sendLine(win, t, sessionIndex, "g_warn DOWN[" + order[orderIdx] + "] " + panesList[p].cmd);
					}

					if (opts.bringUp && order[orderIdx] == panesList[p].order) {
						sendLine(win, t, sessionIndex, "g_warn UP[" + order[orderIdx] + "] dp_up " + panesList[p].cmd);
						sendLine(win, t, sessionIndex, "sleep 30");
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
	sess.write({ text: `echo -ne "\\033]`+oneForTab+`;`+newName+`\\007"` });
	// win.tabs[t].sessions[sessionIndex].name = newName
}
function sendKeys(win, tabIndex, sessionIndex, message){
	win.tabs[tabIndex].sessions[sessionIndex].write({ text: message, newline: false });
}
function sendLine(win, tabIndex, sessionIndex, message){
	// console.log("send tab " + tabIndex + " sess " + sessionIndex);
	win.tabs[tabIndex].sessions[sessionIndex].write({ text: message });
}
