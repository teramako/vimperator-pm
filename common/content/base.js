// Copyright (c) 2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the License.txt file included with this file.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

function allkeys(obj) {
    for(; obj; obj = obj.__proto__)
        for (let prop of Object.getOwnPropertyNames(obj))
            yield prop;
}

/**
 * iterate obj's keys and symbols
 * @param {object} obj
 * @returns {Iterator<string|symbol>}
 */
function keys(obj) {
    for (let prop of Object.getOwnPropertyNames(obj))
        yield prop;
    for (let symbol of Object.getOwnPropertySymbols(obj))
        yield symbol;
}

function values(obj) {
    for (var k of Object.keys(obj))
        yield obj[k];
}

function foreach(iter, fn, self) {
    for (let val in iter)
        fn.call(self, val);
}

function dict(ary) {
    var obj = {};
    for (var i = 0; i < ary.length; i++) {
        var val = ary[i];
        obj[val[0]] = val[1];
    }
    return obj;
}

function issubclass(targ, src) {
    return src === targ ||
        targ && typeof targ === "function" && targ.prototype instanceof src;
}

function isinstance(targ, src) {
    const types = {
        boolean: Boolean,
        string: String,
        function: Function,
        number: Number
    }
    src = Array.concat(src);
    for (var i = 0; i < src.length; i++) {
        if (targ instanceof src[i])
            return true;
        var type = types[typeof targ];
        if (type && issubclass(src[i], type))
            return true;
    }
    return false;
}

function isobject(obj) {
    return typeof obj === "object" && obj != null;
}

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Array type. The array may come from
 * any window, frame, namespace, or execution context, which
 * is not the case when using (obj instanceof Array).
 */
function isarray(val) {
    return Array.isArray(val);
}

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Generator type. This includes
 * functions containing the 'yield' statement and generator
 * statements such as (x for (x in obj)).
 */
function isgenerator(val) {
    return Object.prototype.toString.call(val) == "[object Generator]";
}

/**
 * Returns true if and only if its sole argument is a String,
 * as defined by the builtin type. May be constructed via
 * String(foo) or new String(foo) from any window, frame,
 * namespace, or execution context, which is not the case when
 * using (obj instanceof String) or (typeof obj == "string").
 */
function isstring(val) {
    return Object.prototype.toString.call(val) == "[object String]";
}

/**
 * Returns true if and only if its sole argument may be called
 * as a function. This includes classes and function objects.
 */
function callable(val) {
    return typeof val === "function";
}

function call(fn, context, ...args) {
    fn.apply(context, args);
    return fn;
}

/**
 * Curries a function to the given number of arguments. Each
 * call of the resulting function returns a new function. When
 * a call does not contain enough arguments to satisfy the
 * required number, the resulting function is another curried
 * function with previous arguments accumulated.
 *
 *     function foo(a, b, c) [a, b, c].join(" ");
 *     curry(foo)(1, 2, 3) -> "1 2 3";
 *     curry(foo)(4)(5, 6) -> "4 5 6";
 *     curry(foo)(7)(8)(9) -> "7 8 9";
 *
 * @param {function} fn The function to curry.
 * @param {integer} length The number of arguments expected.
 *     @default fn.length
 *     @optional
 * @param {object} self The 'this' value for the returned function. When
 *     omitted, the value of 'this' from the first call to the function is
 *     preserved.
 *     @optional
 */
function curry(fn, length, self, acc) {
    if (length == null)
        length = fn.length;
    if (length == 0)
        return fn;

    // Close over function with 'this'
    function close(self, fn) {
        return () => fn.apply(self, Array.slice(arguments));
    }

    if (acc == null)
        acc = [];

    return function () {
        let args = acc.concat(Array.slice(arguments));

        // The curried result should preserve 'this'
        if (arguments.length == 0)
            return close(self || this, arguments.callee);

        if (args.length >= length)
            return fn.apply(self || this, args);

        return curry(fn, length, self || this, args);
    };
}

/**
 * Updates an object with the properties of another object. Getters
 * and setters are copied as expected. Moreover, any function
 * properties receive new 'supercall' and 'superapply' properties,
 * which will call the identically named function in target's
 * prototype.
 *
 *    let a = { foo: function (arg) "bar " + arg }
 *    let b = { __proto__: a }
 *    update(b, { foo: function () arguments.callee.supercall(this, "baz") });
 *
 *    a.foo("foo") -> "bar foo"
 *    b.foo()      -> "bar baz"
 *
 * @param {Object} target The object to update.
 * @param {Object} src The source object from which to update target.
 *    May be provided multiple times.
 * @returns {Object} Returns its updated first argument.
 */
function update(target, ...sources) {
    for (let src of sources) {
        if (!src)
            continue;

        foreach(keys(src), function (k) {
            let desc = Object.getOwnPropertyDescriptor(src, k);
            Object.defineProperty(target, k, desc);
            if (("value" in desc) && callable(desc.value)) {
                let v = desc.value,
                    proto = Object.getPrototypeOf(target);
                if (proto && (k in proto) && callable(proto[k])) {
                    v.superapply = function superapply(self, args) {
                        return proto[k].apply(self, args);
                    };
                    v.supercall = function supercall(self, ...args) {
                        return v.superapply(self, args);
                    };
                } else
                    v.superapply = v.supercall = function dummy() {};
            }
        });
    }
    return target;
}

/**
 * Extends a subclass with a superclass. The subclass's
 * prototype is replaced with a new object, which inherits
 * from the superclass's prototype, {@see update}d with the
 * members of 'overrides'.
 *
 * @param {function} subclass
 * @param {function} superclass
 * @param {Object} overrides @optional
 */
function extend(subclass, superclass, overrides) {
    subclass.prototype = {};
    update(subclass.prototype, overrides);
    // This is unduly expensive. Unfortunately necessary since
    // we apparently can't rely on the presence of the
    // debugger to enumerate properties when we have
    // __iterators__ attached to prototypes.
    subclass.prototype.__proto__ = superclass.prototype;

    subclass.superclass = superclass.prototype;
    subclass.prototype.constructor = subclass;
    subclass.prototype.__class__ = subclass;

    if (superclass.prototype.constructor === Object.prototype.constructor)
        superclass.prototype.constructor = superclass;
}

/**
 * @constructor Class
 *
 * Constructs a new Class. Arguments marked as optional must be
 * either entirely elided, or they must have the exact type
 * specified.
 *
 * @param {string} name The class's as it will appear when toString
 *     is called, as well as in stack traces.
 *     @optional
 * @param {function} base The base class for this module. May be any
 *     callable object.
 *     @optional
 *     @default Class
 * @param {Object} prototype The prototype for instances of this
 *     object. The object itself is copied and not used as a prototype
 *     directly.
 * @param {Object} classProperties The class properties for the new
 *     module constructor. More than one may be provided.
 *     @optional
 *
 * @returns {function} The constructor for the resulting class.
 */
function Class() {
    var args = Array.slice(arguments);
    if (isstring(args[0]))
        var name = args.shift();
    var superclass = Class;
    if (callable(args[0]))
        superclass = args.shift();

    let Constructor = eval(`(function ${(name || superclass.name).replace(/\W/g, '_')}() {
        let self = {
            __proto__: Constructor.prototype,
            constructor: Constructor,
            get closure() {
                delete this.closure;
                function closure(fn) function () fn.apply(self, arguments);
                for (let k in this)
                    if (!this.__lookupGetter__(k) && callable(this[k]))
                        closure[k] = closure(self[k]);
                return this.closure = closure;
            }
        };
        var res = self.init.apply(self, arguments);
        return res !== undefined ? res : self;
    })`);
    Constructor.__proto__ = superclass;

    if (!("init" in superclass.prototype) && !("init" in args[0])) {
        var superc = superclass;
        superclass = function Shim() {};
        extend(superclass, superc, {
            init: superc
        });
    }

    extend(Constructor, superclass, args[0]);
    if (args[1]) {
        update(Constructor, args[1]);
    }
    args = args.slice(2);
    Array.forEach(args, function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}
Class.toString = function () { return "[class " + this.constructor.name + "]"; };
Class.prototype = {
    /**
     * Initializes new instances of this class. Called automatically
     * when new instances are created.
     */
    init () {},

    toString () { return "[instance " + this.constructor.name + "]"; },

    /**
     * Exactly like {@see nsIDOMWindow#setTimeout}, except that it
     * preserves the value of 'this' on invocation of 'callback'.
     *
     * @param {function} callback The function to call after 'timeout'
     * @param {number} timeout The timeout, in seconds, to wait
     *     before calling 'callback'.
     * @returns {integer} The ID of this timeout, to be passed to
     *     {@see nsIDOMWindow#clearTimeout}.
     */
    setTimeout (callback, timeout) {
        const self = this;
        return window.setTimeout(() => callback.call(self), timeout);
    }
};

/**
 * @class Struct
 *
 * Creates a new Struct constructor, used for creating objects with
 * a fixed set of named members. Each argument should be the name of
 * a member in the resulting objects. These names will correspond to
 * the arguments passed to the resultant constructor. Instances of
 * the new struct may be treated very much like arrays, and provide
 * many of the same methods.
 *
 *     const Point = Struct("x", "y", "z");
 *     let p1 = Point(x, y, z);
 *
 * @returns {function} The constructor for the new Struct.
 */
function Struct(...args) {
    const Struct = Class("Struct", StructBase, {
        length: args.length,
        members: args
    });
    args.forEach(function (name, i) {
        Object.defineProperty(Struct.prototype, name, {
            get() { return this[i]; },
            set(val) { this[i] = val },
            enumerable: true,
        });
    });
    return Struct;
}
const StructBase = Class("StructBase", {
    init (...args) {
        for (var i = 0, len = args.length; i < len; ++i)
            if (args[i] != null)
                this[i] = args[i];
    },

    clone () { return this.constructor.apply(null, this.slice()); },

    // Iterator over our named members
    *[Symbol.iterator]() {
        for (const key of this.members) {
            yield [key, this[key]];
        }
    }
}, {
    /**
     * Sets a lazily constructed default value for a member of
     * the struct. The value is constructed once, the first time
     * it is accessed and memoized thereafter.
     *
     * @param {string} key The name of the member for which to
     *     provide the default value.
     * @param {function} val The function which is to generate
     *     the default value.
     */
    defaultValue (key, val) {
        let proto = this.prototype;
        let i = proto.members.indexOf(key);
        if (i === -1)
            return;

        Object.defineProperty(this.prototype, i, {
            get () {
                if (this === proto)
                    return;

                var value = val.call(this);
                Object.defineProperty(this, i, {
                    value: value,
                    writable: true
                });
                return value;
            },
            set (value) {
                if (this === proto)
                    return;

                Object.defineProperty(this, i, {
                    value: value,
                    writable: true,
                })
            },
        });
    }
});
// Add no-sideeffect array methods. Can't set new Array() as the prototype or
// get length() won't work.
for (let k in values(["concat", "every", "filter", "forEach", "indexOf", "join", "lastIndexOf",
                      "map", "reduce", "reduceRight", "reverse", "slice", "some", "sort"]))
    StructBase.prototype[k] = Array.prototype[k];

// vim: set fdm=marker sw=4 ts=4 et:
