/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string; //
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    // 指明当前是哪个组件实例
    this.vm = vm
    if (isRenderWatcher) {
      // 渲染Watcher，组件的_watcher就是渲染函数观察者
      vm._watcher = this
    }
    // 所有的Watcher都会被加入_watchers 控制台打印
    vm._watchers.push(this)
    // options
    if (options) {
      // 是否是深度观测
      this.deep = !!options.deep
      // 是否为用户的Watcher
      this.user = !!options.user
      // computed Watcher计算属性的依赖缓存延迟计算，计算属性是惰性求值
      this.lazy = !!options.lazy
      // 是否为同步求值并执行回调,watch可配置sync:true来提升优先级，sync为true，在update方法会直接run方法，否则就会通过quenewatch加入到微任务异步去执行
      this.sync = !!options.sync
      // 实例钩子
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers 为计算属性定制的，dirty为true代表还没有对当前的计算属性watcher进行求值
    // 此处为避免依赖重复搜集
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    // 定义expression。本地开发时候为值的表达式为字符串，生产环境为空字符串
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    // expOrFn为函数，直接赋值给getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      // 用户定义的watch expOrFn可能是字符串
      // 否则把expOrFn给到parsePath函数处理
      // 比如用户定义的watch，监听obj.a这种情况为字符串需要解析
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        // getter函数不存在赋值为noop，空函数
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // lazy为true，既当前watcher为计算属性时候， 不对立即表达式求值，直接返回undefined，计算属性到此结束，只有在访问到计算属性才会触发depend方法
    this.value = this.lazy
      ? undefined
      // 渲染watch和用户watch会执行这里的求值
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  /**
   * 1.触发访问器属性的 get 拦截器函数
   * 2.获得被观察目标的值
   */
  get () {
    // 把当前正在计算的Watcher(页面渲染或者计算属性或者用户watch)通过pushTarget方法，把当前全局Dep.target设置为正在计算的Watcher
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      // 如果是渲染Watcher执行updateComponent逻辑
      // 如果是user watch,这里的getter就是parsePath方法返回的匿名函数。第一个参数vm会被作为obj传入parsePath方法，从而访问到data中定义的属性，vm.data.xxx,触发到reactiveGetter中的get函数，完成依赖搜集
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 如果是user watch，配置了deep为true，则通过traverse方法遍历触发里面所有的getter
      if (this.deep) {
        traverse(value)
      }
      // 恢复到上一次正在计算的target
      popTarget()
      //
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    // 当前id不存在进行添加
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // dep的方法，把当前Watcher添加到subs里面，数据发生变化时候可以通知到Watcher更新
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  // 清除一些依赖搜集
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    // 原来的计算属性this.computed，计算属性被触发被触发update
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {  // 当值变化发生时是否同步更新变化，渲染函数不是同步变化更新，而是会放到一个异步更新队列中queueWatcher
      this.run()
    } else {
      // 队列Watcher
      // 将观察者放到一个队列中等待调用栈被清空之后按照一定的顺序执行更新
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    // 用来标志当前观察者是否处于激活或者可用状态
    if (this.active) {
      // 再次求值，如果是渲染函数，这时候它的getter就是updateComponent,当修改数据时候重新渲染重新生成dom
      const value = this.get()
      // 渲染函数不会执行这里的if，updateComponent 的返回值是undefined
      // computedWatcher计算属性的watcher只有值不相同时候才会触发响应
      if (
        // 新值和旧值作对比，如果值不一样或者值是一个对象，或者deep存在
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        // 执行用户自定义的watcher，并且把新值和旧值传递进去,对于渲染watcher，this.cb是空noop函数
        /**
         * new Watcher(vm, updateComponent, noop, {
            before () {
              if (vm._isMounted && !vm._isDestroyed) {
                callHook(vm, 'beforeUpdate')
              }
            }
          }, true)
          */
        if (this.user) {
          // 如果用户定义的watcher出现错误提示，expression是表达式的字符串
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  // 对lazy watcher求值
  evaluate () {
    // 重新触发getter，此时的this.get()是用户自定义的计算属性函数
    this.value = this.get()
    // 代表已经对计算属性的watcher进行了求值
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
