/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'
// 先缓存原来的数组类型的prototype
const arrayProto = Array.prototype
// 对数组变异方法的拦截，arrayMethods.__proto__ === Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
// 对数组方法进行遍历
methodsToPatch.forEach(function (method) {
  // cache original method
  // 先缓存原生的数组方法
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    // 先获取原生方法执行的结果
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    if (inserted) ob.observeArray(inserted)
    // notify change
    ob.dep.notify()
    return result
  })
})
