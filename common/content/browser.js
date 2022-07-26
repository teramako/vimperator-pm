// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the License.txt file included with this file.


/** @scope modules */

/**
 * @instance browser
 */
const Browser = Module("browser", {
}, {
    // TODO: support 'nrformats'? -> probably not worth it --mst
    incrementURL(count) {
        let matches = buffer.URL.match(/(.*?)(\d+)(\D*)$/);
        liberator.assert(matches);

        let [, pre, number, post] = matches;
        let newNumber = parseInt(number, 10) + count;
        let newNumberStr = String(newNumber > 0 ? newNumber : 0);
        if (number.match(/^0/)) { // add 0009<C-a> should become 0010
            while (newNumberStr.length < number.length)
                newNumberStr = "0" + newNumberStr;
        }

        liberator.open(pre + newNumberStr + post);
    }
}, {
    options() {
        options.add(["encoding", "enc"],
            "Sets the current buffer's character encoding",
            "string", "UTF-8",
            {
                scope: Option.SCOPE_LOCAL,
                getter () { return config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset; },
                setter (val) {
                    if (options.encoding == val)
                        return val;

                    // Stolen from browser.jar/content/browser/browser.js, more or less.
                    try {
                        config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset = val;
                        if (PlacesUtils.history.setCharsetForURI)
                            PlacesUtils.history.setCharsetForURI(getWebNavigation().currentURI, val);
                        else
                            PlacesUtils.setCharsetForURI(getWebNavigation().currentURI, val);
                        getWebNavigation().reload(Ci.nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE);
                    }
                    catch (e) { liberator.echoerr(e); }
                    return null;
                },
                completer(context) { return completion.charset(context); }
            });

        options.add(["urlseparator"],
            "Set the separator regex used to separate multiple URL args",
            "string", ",\\s");

        options.add(["yankencodedurl"],
            "Set the yank mode copying encoded URL",
            "boolean", false);
    },

    mappings() {
        mappings.add([modes.NORMAL],
            ["y"], "Yank current location to the clipboard",
            function () {
                var url = buffer.URL;
                if (options.get("yankencodedurl").value)
                    url = services.get("io").newURI(url, buffer.charser, null).asciiSpec;
                else
                    url = services.get("textToSubURI").unEscapeURIForUI(buffer.charset, url).replace(/ /g, "%20");
                util.copyToClipboard(url, true);
            });

        // opening websites
        mappings.add([modes.NORMAL],
            ["o"], "Open one or more URLs",
            function () { commandline.open("", "open ", modes.EX); });

        mappings.add([modes.NORMAL], ["O"],
            "Open one or more URLs, based on current location",
            function () {
                var url = services.get("textToSubURI").unEscapeURIForUI(buffer.charset, buffer.URL);
                commandline.open("", "open " + url, modes.EX);
            });

        mappings.add([modes.NORMAL], ["t"],
            "Open one or more URLs in a new tab",
            function () { commandline.open("", "tabopen ", modes.EX); });

        mappings.add([modes.NORMAL], ["T"],
            "Open one or more URLs in a new tab, based on current location",
            function () {
                var url = services.get("textToSubURI").unEscapeURIForUI(buffer.charset, buffer.URL);
                commandline.open("", "tabopen " + url, modes.EX);
            });

        mappings.add([modes.NORMAL], ["w"],
            "Open one or more URLs in a new window",
            function () { commandline.open("", "winopen ", modes.EX); });

        mappings.add([modes.NORMAL], ["W"],
            "Open one or more URLs in a new window, based on current location",
            function () {
                var url = services.get("textToSubURI").unEscapeURIForUI(buffer.charset, buffer.URL);
                commandline.open("", "winopen " + url, modes.EX);
            });

        mappings.add([modes.NORMAL],
            ["<C-a>"], "Increment last number in URL",
            function (count) { Browser.incrementURL(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL],
            ["<C-x>"], "Decrement last number in URL",
            function (count) { Browser.incrementURL(-Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["~"],
            "Open home directory",
            function () { liberator.open("~"); });

        mappings.add([modes.NORMAL], ["gh"],
            "Open homepage",
            function () { BrowserHome(); });

        mappings.add([modes.NORMAL], ["gH"],
            "Open homepage in a new tab",
            function () {
                let homepages = gHomeButton.getHomePage().split('|');
                liberator.open(homepages, { from: "homepage", where: liberator.NEW_TAB });
            });

        mappings.add([modes.NORMAL], ["gu"],
            "Go to parent directory",
            function (count) {
                function getParent(url, count) {
                    function getParentPath(path) {
                        if (!path)
                            return;

                        path = path.replace(/\/$/, "").replace(/^\/+/, "");
                        if (path.indexOf("#") > 0)
                            return path.replace(/#.*/, "");

                        if (path.indexOf("?") > 0)
                            return path.replace(/\?.*/, "");

                        path = path.replace(/\/+$/, "");
                        if (path.indexOf("/") > 0)
                            return path.replace(/\/[^\/]*$/,"/");
                    }

                    function getParentHost(host) {
                        if (!/\./.test(host) || /^[0-9+.:]+$/.test(host))
                            return host;

                        let hostSuffix = "";
                        let x = host.lastIndexOf(":");
                        if (x > 0) {
                            hostSuffix = host.substr(x);
                            host = host.substr(0, x);
                        }
                        hostSuffix = host.substr(host.length - 6) + hostSuffix;
                        host = host.substr(0, host.length - 6);
                        return host.replace(/[^.]*\./, "") + hostSuffix;
                    }

                    let parent = url;
                    let regexp = new RegExp("([a-z]+:///?)([^/]*)(/.*)");
                    let [, scheme, host, path] = regexp.exec(url);
                    path = path.replace(/\/$/, "").replace(/^\/+/, "");
                    for (let i = 0; i < count; i++) {
                        if (path) {
                            if (path = getParentPath(path))
                                parent = scheme + host + "/" + path;
                            else
                                parent = scheme + host + "/";
                        }
                        else {
                            host = getParentHost(host);
                            parent = scheme + host + "/";
                        }
                    }
                    return parent;
                }

                if (count < 1)
                    count = 1;
                let url = getParent(buffer.URL, count);

                if (url == buffer.URL)
                    liberator.beep();
                else
                    liberator.open(url);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["gU"],
            "Go to the root of the website",
            function () {
                let uri = content.document.location;
                liberator.assert(!/(about|mailto):/.test(uri.protocol)); // exclude these special protocols for now
                liberator.open(uri.protocol + "//" + (uri.host || "") + "/");
            });
        mappings.add([modes.NORMAL], ["gr"],
            "View current tab in Reader View",
            function () {
                let uri = content.document.location.href;
                if (!uri.startsWith("about:reader")) {
                    liberator.open('about:reader?url=' + uri);
                } else {
                    liberator.open(uri.substr("about:reader?url=".length));
                }
            });
    },

    commands() {
        commands.add(["downl[oads]", "dl"],
            "Show progress of current downloads",
            function () {
                liberator.open("chrome://browser/content/downloads/contentAreaDownloadsView.xul",
                    { from: "downloads"});
            },
            { argCount: "0" });

        commands.add(["o[pen]"],
            "Open one or more URLs in the current tab",
            function (args) {
                args = args.string;

                if (args)
                    liberator.open(args);
                else
                    liberator.open("");
            }, {
                canonicalize(cmd) { return cmd.replace(/^(op?|open?)\b/, 'open'); },
                completer(context) { return completion.url(context); },
                literal: 0,
                privateData: true
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
