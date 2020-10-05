/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 * 在某些情况下，我们可能希望在组件的更新计算中禁用观察。
 */
export let shouldObserve: boolean = true
// 全局控制要不要执行Observer的逻辑
export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    // 获取当前的value
    this.value = value
    //
    this.dep = new Dep()
    this.vmCount = 0
    // 通过Object.defineProperty方法给value添加一个__ob__属性，属性的值为当前实例
    // 为什么不直接通过value.__ob__ = this方法去添加？因为__ob__属性不需要枚举，不然walk方法也会Observer到__ob__
    def(value, '__ob__', this)
    // 数组
    if (Array.isArray(value)) {
      // 是否可以使用 __proto__
      // export const hasProto = '__proto__' in {}
      // __proto__ 属性是在 IE11+ 才开始支持
      if (hasProto) {
        // 设置数组实例的 __proto__ 属性
        // arrayMethods作用是修改原生数组方法
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 对数组中每个元素遍历，进行observer观测
      this.observeArray(value)
    } else {
      // 不是数组可能是对象的情况，遍历每一个对象属性，执行defineReactive
      // 这里没有对数组做walk的defineReactive处理。所以vue不支持数组下标方式更改
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  // 遍历每一个对象属性，执行defineReactive
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  // 遍历每一个数组元素，将其observe
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object) {
  // target原型链指向arrayMethods
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
// 创建观察者 value观察的对象 asRootData是不是根数据
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 如果value不是一个普通对象或者是VNode 直接返回
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  // hasOwn判断value有没有__ob__这个属性 如果已经是Observer的实例
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    // 直接获取
    ob = value.__ob__
  } else if (
    // 标志位
    shouldObserve &&
    // 不再服务端渲染的情况下
    !isServerRendering() &&
    // 是一个数组或者纯object对象
    (Array.isArray(value) || isPlainObject(value)) &&
    // 方法判断一个对象是否是可扩展的（是否可以在它上面添加新的属性）。
    Object.isExtensible(value) &&
    // 不是Vue本身
    !value._isVue
  ) {
    // 创建观察者
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 * 在对象上定义一个响应式属性
 * 把对象变成响应式对象
 */
export function defineReactive (
  // 对象
  obj: Object,
  // 对象属性值
  key: string,
  // 初始值
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep()
  // 返回指定对象上一个自有属性对应的属性描述符
  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 如果是一个不可配置对象，直接return
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  // 满足getter不存在 arguments长度为2，特殊边界情况处理
  // 当用户通过Object.defineProperty定义的属性，设置了get函数，val就是undefined，不执行深度观测
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }
  // 当某个属性值是对象的话，递归调用observe。对象本身以及子对象都会是响应式对象
  // shallow 默认为深度观测
  let childOb = !shallow && observe(val)
  // 响应式对象
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // 访问属性触发get，依赖搜集，搜集当前的Watcher
    get: function reactiveGetter () {
      // getter存在尝试执行获取值，没有的话直接返回val
      // getter 常量中保存的是属性原有的 get 函数，如果 getter 存在那么直接调用该函数，并以该函数的返回值作为属性的值，保证属性的原有读取操作正常运作
      const value = getter ? getter.call(obj) : val
      // 依赖搜集
      // 如果此时存在Dep.target 存在当前计算的Watcher,就是需要被搜集的依赖
      // 这里的会在执行_render()时候访问到,当前存在等待搜集的依赖才会执行
      if (Dep.target) {
        // 执行Watcher类里面的addDep，最终会调用addSub()方法，将其添加到subs这个数组中,作为订阅者
        dep.depend()
        // 如果存在childOb，即子value是一个对象
        if (childOb) {
          // 为了让Vue.set可以通知到
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    // 设置属性触发set，派发更新
    set: function reactiveSetter (newVal) {
      // 获取新值用来和旧值做对比
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 值和原来的相等 或者 原来的都是NaN的情况(NaN !== NaN)
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      // initRender中调用defineReactive传递的customSetter函数
      // 作用是当你尝试修改 vm.$attrs 属性的值时，打印一段信息：$attrs 属性是只读的。这就是 customSetter 函数的作用，用来打印辅助信息，
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      // 有getter没有setter的访问器属性
      if (getter && !setter) return
      // 如果属性原来拥有自身的 set 函数，那么应该继续使用该函数来设置属性的值，从而保证属性原有的设置操作不受影响
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 假如我们为属性设置的新值是一个数组或者纯对象，那么该数组或纯对象是未被观测的，所以需要对新值进行观测
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
// 动态为数组或者对象添加属性
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }

  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
