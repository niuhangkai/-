/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
// 🔗连接数据和watcher
export default class Dep {
  // 静态属性 当前正在计算的Watcher
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor() {
    // 自身的uid 自增
    this.id = uid++
    // 所有的watcher，订阅数据的会被保存到subs
    this.subs = []
  }
  // 执行render时候会访问到数据，触发getter，通过dep.depend()将当前的Watcher添加到subs里面
  // 依赖搜集完成
  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  depend () {
    // 存在计算属性的Watcher
    if (Dep.target) {
      // 这里是Watcher.addDep(),因为当前Dep.target就是Watcher
      Dep.target.addDep(this)
    }
  }
  // 派发更新过程
  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    // 同步执行时候，flushSchedulerQueue()同步执行，无法保证执行的先后顺序，所以需要先排序一遍
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 遍歷Dep实例对象subs属性
    for (let i = 0, l = subs.length; i < l; i++) {
      // 调用this.subs里面的每一个watcher的update方法
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.

// 当前正在计算的Watcher是哪个，全局对象
Dep.target = null

// 栈数据结构
const targetStack = []
// 把当前的target赋值给全局的Dep.target
// 组件嵌套情况 子组件执行完挂载，可以恢复到父组件target的情况
export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

// 组件渲染顺序为父执行到beforeMount，在执行子组件的mount之后，返回来执行父组件的mount
export function popTarget () {
  targetStack.pop()
  // 恢复target
  Dep.target = targetStack[targetStack.length - 1]
}
