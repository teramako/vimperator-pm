/***** BEGIN LICENSE BLOCK ***** {{{
 Copyright ©2008-2009 by Kris Maglione <maglione.k at Gmail>

 Permission is hereby granted, free of charge, to any person obtaining a
 copy of this software and associated documentation files (the "Software"),
 to deal in the Software without restriction, including without limitation
 the rights to use, copy, modify, merge, publish, distribute, sublicense,
 and/or sell copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
 THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 DEALINGS IN THE SOFTWARE.
}}} ***** END LICENSE BLOCK *****/

var EXPORTED_SYMBOLS = ["storage", "Timer"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// XXX: does not belong here
function Timer(minInterval, maxInterval, callback) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this.doneAt = 0;
    this.latest = 0;
    this.notify = function (aTimer) {
        timer.cancel();
        this.latest = 0;
        // minInterval is the time between the completion of the command and the next firing
        this.doneAt = Date.now() + minInterval;

        try {
            callback(this.arg);
        }
        finally {
            this.doneAt = Date.now() + minInterval;
        }
    };
    this.tell = function (arg) {
        if (arguments.length > 0)
            this.arg = arg;

        let now = Date.now();
        if (this.doneAt == -1)
            timer.cancel();

        let timeout = minInterval;
        if (now > this.doneAt && this.doneAt > -1)
            timeout = 0;
        else if (this.latest)
            timeout = Math.min(timeout, this.latest - now);
        else
            this.latest = now + maxInterval;

        timer.initWithCallback(this, Math.max(timeout, 0), timer.TYPE_ONE_SHOT);
        this.doneAt = -1;
    };
    this.reset = function () {
        timer.cancel();
        this.doneAt = 0;
    };
    this.flush = function () {
        if (this.doneAt == -1)
            this.notify();
    };
}

function getFile(name) {
    let file = storage.infoPath.clone();
    file.append(name);
    return file;
}

function readFile(file) {
    let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    let stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);

    try {
        fileStream.init(file, -1, 0, 0);
        stream.init(fileStream, "UTF-8", 4096, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER); // 4096 bytes buffering

        let hunks = [];
        let res = {};
        while (stream.readString(4096, res) != 0)
            hunks.push(res.value);

        stream.close();
        fileStream.close();

        return hunks.join("");
    }
    catch (e) {}
}

function writeFile(file, data) {
    if (!file.exists())
        file.create(file.NORMAL_FILE_TYPE, 0600);

    let fileStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);

    fileStream.init(file, 0x20 | 0x08 | 0x02, 0600, 0); // PR_TRUNCATE | PR_CREATE | PR_WRITE
    stream.init(fileStream, "UTF-8", 0, 0);

    stream.writeString(data);

    stream.close();
    fileStream.close();
}

var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
var prefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.liberator.datastore.");

function getCharPref(name) {
    try {
        return prefService.getComplexValue(name, Ci.nsISupportsString).data;
    }
    catch (e) {}
}

function setCharPref(name, value) {
    var str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
    str.data = value;
    return prefService.setComplexValue(name, Ci.nsISupportsString, str);
}

function loadPref(name, store, type) {
    try {
        if (store)
            var pref = getCharPref(name);
        if (!pref && storage.infoPath)
            var file = readFile(getFile(name));
        if (pref || file)
            var result = JSON.parse(pref || file);
        if (pref) {
            prefService.clearUserPref(name);
            savePref({ name: name, store: true, serial: pref });
        }
        if (result instanceof type)
            return result;
    }
    catch (e) {}
}

function savePref(obj) {
    if (obj.store && storage.infoPath)
        writeFile(getFile(obj.name), obj.serial);
}

var prototype = {
    OPTIONS: ["privateData"],
    fireEvent(event, arg) { storage.fireEvent(this.name, event, arg); },
    save() { savePref(this); },
    init(name, store, data, options) {
        Object.defineProperties(this, {
            store: {
                get() { return store },
                enumerable: true,
                configurable: true
            },
            name: {
                get() { return name },
                enumerable: true,
                configurable: true
            }
        });
        for (let [k, v] in Iterator(options))
            if (this.OPTIONS.indexOf(k) >= 0)
                this[k] = v;
        this.reload();
    }
};

function ObjectStore(name, store, load, options) {
    var object = {};

    this.reload = function reload() {
        object = load() || {};
        this.fireEvent("change", null);
    };

    this.init.apply(this, arguments);
    Object.defineProperty(this, "serial", {
        get() { return JSON.stringify(object); },
        enumerable: true,
        configurable: true
    });

    this.set = function set(key, val) {
        var defined = key in object;
        var orig = object[key];
        object[key] = val;
        if (!defined)
            this.fireEvent("add", key);
        else if (orig != val)
            this.fireEvent("change", key);
    };

    this.remove = function remove(key) {
        var ret = object[key];
        delete object[key];
        this.fireEvent("remove", key);
        return ret;
    };

    this.get = function get(val, default_) { return val in object ? object[val] : default_; };

    this.clear = function () {
        object = {};
    };

    this[Symbol.iterator] = function* () { yield* Object.entries(object); }
}
ObjectStore.prototype = prototype;

function ArrayStore(name, store, load, options) {
    var array = [];

    this.reload = function reload() {
        array = load() || [];
        this.fireEvent("change", null);
    };

    this.init.apply(this, arguments);
    Object.defineProperties(this, {
        serial: {
            get() { return JSON.stringify(array); },
            enumerable: true,
            configurable: true
        },
        length: {
            get() { return array.length; },
            enumerable: true,
            configurable: true
        }
    });

    this.set = function set(index, value) {
        var orig = array[index];
        array[index] = value;
        this.fireEvent("change", index);
    };

    this.push = function push(value) {
        array.push(value);
        this.fireEvent("push", array.length);
    };

    this.pop = function pop(value) {
        var ret = array.pop();
        this.fireEvent("pop", array.length);
        return ret;
    };

    this.truncate = function truncate(length, fromEnd) {
        var ret = array.length;
        if (array.length > length) {
            if (fromEnd)
                array.splice(0, array.length - length);
            array.length = length;
            this.fireEvent("truncate", length);
        }
        return ret;
    };

    // XXX: Awkward.
    this.mutate = function mutate(aFuncName) {
        var funcName = aFuncName;
        arguments[0] = array;
        array = Array[funcName].apply(Array, arguments);
        this.fireEvent("change", null);
    };

    this.get = function get(index) {
        return index >= 0 ? array[index] : array[array.length + index];
    };

    this[Symbol.iterator] = function* () { yield* Object.entries(array); }
}
ArrayStore.prototype = prototype;

/**
 * @template {string} key
 * @type {{key: ObjectStore | ArrayStore}}
 */
var keys = {};
/**
 * @type {{key: [{ref: boolean, callback: function}]}}
 */
var observers = {};
/**
 * @type {{key: Timer}}
 */
var timers = {};

var storage = {
    alwaysReload: {},
    newObject(key, constructor, params) {
        if (!params.reload && !params.store) {
            let enumerator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator).getEnumerator("navigator:browser");
            params.reload = enumerator.hasMoreElements() && enumerator.getNext() && !enumerator.hasMoreElements();
        }

        if (!(key in keys) || params.reload || this.alwaysReload[key]) {
            if (key in this && !(params.reload || this.alwaysReload[key]))
                throw Error();
            const load = function () { return loadPref(key, params.store, params.type || Object); };
            keys[key] = new constructor(key, params.store, load, params);
            timers[key] = new Timer(1000, 10000, () => storage.save(key));
            Object.defineProperty(this, key, {
                get() { return keys[key]; },
                enumerable: true,
                configurable: true
            });
        }
        return keys[key];
    },

    newMap(key, options) {
        return this.newObject(key, ObjectStore, options);
    },

    newArray(key, options) {
        return this.newObject(key, ArrayStore, options);
    },

    addObserver(key, callback, ref) {
        if (ref) {
            if (!ref.liberatorStorageRefs)
                ref.liberatorStorageRefs = [];
            ref.liberatorStorageRefs.push(callback);
            var callbackRef = Cu.getWeakReference(callback);
        }
        else {
            callbackRef = { get() { return callback; } };
        }
        this.removeDeadObservers();
        if (!(key in observers))
            observers[key] = [];
        if (!observers[key].some(o => o.callback.get() == callback))
            observers[key].push({ ref: ref && Cu.getWeakReference(ref), callback: callbackRef });
    },

    removeObserver(key, callback) {
        this.removeDeadObservers();
        if (!(key in observers))
            return;
        observers[key] = observers[key].filter(elem => elem.callback.get() != callback);
        if (observers[key].length == 0)
            delete observers[key];
    },

    removeDeadObservers() {
        for (let [key, ary] in Iterator(observers)) {
            observers[key] = ary = ary.filter(o => o.callback.get() && (!o.ref || o.ref.get() && o.ref.get().liberatorStorageRefs));
            if (!ary.length)
                delete observers[key];
        }
    },

    get observers() { return observers; },

    fireEvent(key, event, arg) {
        if (!(key in this))
            return;
        this.removeDeadObservers();
        // Safe, since we have our own Array object here.
        if (key in observers)
            for (let observer of observers[key])
                observer.callback.get()(key, event, arg)
        timers[key].tell();
    },

    loadload(key) {
        if (this[key].store && this[key].reload)
            this[key].reload();
    },

    save(key) {
        savePref(keys[key]);
    },

    saveAll() {
        for (const obj of Object.values(keys))
            savePref(obj);
    },

};

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
