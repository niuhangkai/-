/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

// 共享属性定义
const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  // 代理props以及把Props转为响应式
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    // 代理data以及把data转为响应式
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  // 初始化计算属性
  if (opts.computed) initComputed(vm, opts.computed)
  // 初始化用户的watch
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  // 不是根节点不会被Observer观测
  if (!isRoot) {
    // toggleObserving 方法可以设置决定是否执行Observer
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      // hyphenate方法把驼峰转为短横线分割
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData (vm: Component) {
  // 获取到用户options中的data
  let data = vm.$options.data
  // 代理到_data中
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  // 判断是不是对象
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  // 遍历所有的key，如果已经在methods或者props定义了，开始环境会报错
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      // 把data中的东西代理到vm实例上，可以通过this.xxx访问
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  // 观测data
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

// 初始化计算属性
/**
 *
 计算属性流程梳理，
 1.initState 初始化双向数据绑定、props、data、methods、watch、computed，等属性，执行initComputed
 2.定义常量watchers为空对象，遍历计算属性为其创建计算属性watch，加入到_watchers数组。这里不求值，初始化之后返回。
 3.在创建该组件之前，就已经在父组件中遍历了这个组件的计算属性，执行了defineComputed，
 target是vue.prototype,key就是计算属性的函数名，定义了sharedPropertyDefinition共享属性，get就是我们的计算属性函数，
 最后给到Object.defineProperty做代理，当我们访问this.xxx或者render函数里面时候，就会触发sharedPropertyDefinition的get函数，也就是computedGetter。
 4.get函数，就是computedGetter，通过watcher.evaluate()触发求值。
 */
function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  // 声明一个空对象
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  // 是不是服务端渲染
  const isSSR = isServerRendering()

  // 对当前计算属性中的key进行遍历
  for (const key in computed) {
    const userDef = computed[key]
    // 如果计算属性当前是一个函数就直接使用函数，否则获取它的getter
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      // 创建计算属性watcher,noop为空函数
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        // lazy:true
        computedWatcherOptions
      )
    }
    // 组件中定义的计算属性已经在组件的prototype上定义了，
    // 在global-api-extend.js中，创建子组件构造器时候提前赋值原型上，然后遍历执行defineComputed函数
    /**
     * if (Sub.options.computed) {
        initComputed(Sub)
      }
     */
    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    // 对当前是不是在data,props有重复定义做一次检测
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}
// 经过defineComputed处理的sharePropertyDefinition
/**
 * sharedPropertyDefinition = {
    enumerable: true,
    configurable: true,
    get: createComputedGetter(key),
    set: userDef.set // 或 noop
  }
  defineComputed的主要作用是让计算属性挂载到vm上面
 */
export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  // !isServerRendering()  执行结果浏览器环境为true
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
    // 如果定义的计算属性是一个函数，执行获取createComputedGetter(key)的返回值
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (process.env.NODE_ENV !== 'production' &&
    sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  // 对计算属性进行代理，计算属性的render函数被执行会触发sharedPropertyDefinition的get函数
  // 之所以能通过this.xxx访问到计算属性是因为这里做了代理。key就是xxx,render访问this.xxx会触发sharedPropertyDefinition
    Object.defineProperty(target, key, sharedPropertyDefinition)
}


function createComputedGetter (key) {
  // 当访问计算属性this.xxx时候就会触发这里的computedGetter函数
  return function computedGetter () {
    // watchers和_computedWatchers有着相同的索引，上面watchers赋值_computedWatchers也会有值
    // this._computedWatchers就是计算属性watch
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      // 第一次的dirty为true
      if (watcher.dirty) {
        // evaluate，手动触发watcher中的get求值，执行getter.call()就是执行了计算属性的函数。访问里面的this.xxx触发依赖搜集和渲染watcher
        watcher.evaluate()
      }
      /**
       * export function popTarget () {
          targetStack.pop()
          Dep.target = targetStack[targetStack.length - 1]
        }
       */
      // 这里的左右是在访问data中定义的属性时候，可以和计算属性双向搜集依赖
      // 把 dep.Target 重置为渲染 watcher。Dep.target存在继续执行
      if (Dep.target) {
        watcher.depend()
      }
      return watcher.value
    }
  }
}

function createGetterInvoker (fn) {
  return function computedGetter () {
    return fn.call(this, this)
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

// 初始化watch
function initWatch (vm: Component, watch: Object) {
  for (const key in watch) {
    // 遍历获取每一个watch，handler是当前的watch函数
    const handler = watch[key]
    // 用户定义的watch可以是一个数组Array<function>
    /*
     * watch: {
        // 可以是一个数组，里面写callback
        name: [
          function () {
            console.log('name 改变了1')
          },
          function () {
            console.log('name 改变了2')
          }
        ]
      },
     */
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        // 对数组中的每一个函数执行createWatcher
        createWatcher(vm, key, handler[i])
      }
    } else {
      // 不是数组的话直接执行createWatcher
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher (
  // 当前实例
  vm: Component,
  // expOrFn 函数名称
  expOrFn: string | Function,
  // 用户的函数
  handler: any,
  options?: Object
) {
  /**
   * handler可以是一个对象,如果是一个对象，把原对象赋值给options，把原对象中的handler函数重新赋值给handler
   * watch: {
   *  name: {
   *    handler() {},
   *    deep:true
   *  }
   *
   * }
   */
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  /**
   * handler可以是一个字符串，对应methods中的函数名
   * watch: {
        // 字符串对应的就是methods中的方法，num改变的时候会调用watchChange方法
        num: 'watchChange',
      }
   */
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  // handler是回调函数
  // expOrFn 函数名称
  // options 如果handler是一个对象 options === handler
  /**
   * this.$watch的用法
   * this.$watch('xxx', (new, old) => {
      ...
    })
   */
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    // 如果cb是一个对象,重新去执行createWatcher函数
    /**
     * this.$watch('xxx', {
        handler() {},
        deep:true
      })
     */
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    // user设置为true说明是一个user watch
    options.user = true
    const watcher = new Watcher(vm, expOrFn, cb, options)
    // immediate，如果用户配置了，那就立即执行一次函数
    if (options.immediate) {
      try {
        cb.call(vm, watcher.value)
      } catch (error) {
        handleError(error, vm, `callback for immediate watcher "${watcher.expression}"`)
      }
    }
    /**
     * vm.$watch 返回一个取消观察函数，用来停止触发回调：

      var unwatch = vm.$watch('a', cb)
      // 之后取消观察
      unwatch()
     */
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
