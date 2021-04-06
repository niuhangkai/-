/* @flow */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove
} from 'core/util/index'

import { createEmptyVNode } from 'core/vdom/vnode'
import { currentRenderingInstance } from 'core/instance/render'

function ensureCtor (comp: any, base) {
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) {
    comp = comp.default
  }
  return isObject(comp)
    ? base.extend(comp)
    : comp
}
// 异步加载创建空的vnode占位
export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  // 创建空的vnode
  const node = createEmptyVNode()
  // asyncFactory设置为传入的函数
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}

export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  // 高级异步组件
  // 如果超时什么的有error，forceRender重新加载到这里直接返回一个errorComp组件
  if (isTrue(factory.error) && isDef(factory.errorComp)) {
    return factory.errorComp
  }
  // 第一次不存在，执行一次之后就会保存在factory.resolved
  if (isDef(factory.resolved)) {
    return factory.resolved
  }

  const owner = currentRenderingInstance
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner)
  }
  // 高级异步组件，forceRender重新加载到这里直接返回一个loading组件
  if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
    return factory.loadingComp
  }

  if (owner && !isDef(factory.owners)) {
    const owners = factory.owners = [owner]
    let sync = true
    let timerLoading = null
    let timerTimeout = null

    ;(owner: any).$on('hook:destroyed', () => remove(owners, owner))

    const forceRender = (renderCompleted: boolean) => {
      // 对vm实例遍历
      for (let i = 0, l = owners.length; i < l; i++) {
        // 执行每一个vm的$forceUpdate
        (owners[i]: any).$forceUpdate()
      }

      if (renderCompleted) {
        owners.length = 0
        if (timerLoading !== null) {
          clearTimeout(timerLoading)
          timerLoading = null
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout)
          timerTimeout = null
        }
      }
    }
    // 工厂函数传入的。once函数就是保证传入的函数只执行一次
    // 加载成功后会执行这里的逻辑resolve(res)
    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      // 通过ensureCtor返回异步组件构造器，保存在factory.resolved中
      factory.resolved = ensureCtor(res, baseCtor)
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      // 这里下面已经执行了sync=false
      if (!sync) {
        forceRender(true)
      } else {
        owners.length = 0
      }
    })
    // 工厂函数传入的
    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) {
        factory.error = true
        forceRender(true)
      }
    })
    // factory会触发webpack的加载机制，我们定义的require函数，代码是异步执行的，下面的同步代码会被先执行
    // factory = require(['./components/hello'],function(res){

    // })
    const res = factory(resolve, reject)

    if (isObject(res)) {
      if (isPromise(res)) {
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isPromise(res.component)) {
        // 高级异步组件
        res.component.then(resolve, reject)
        // 定义了error  扩展一个errorComp，通过ensureCtor确保是一个构造器
        if (isDef(res.error)) {
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) {
          // 如果传了loading，定义loading组件的构造器组件
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          if (res.delay === 0) {
            // 如果延迟给了0，那么直接把loading置为true，这里会影响最后的返回值，会返回loadingComp组件，然后去渲染
            factory.loading = true
          } else {
            timerLoading = setTimeout(() => {
              timerLoading = null
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true
                forceRender(false)
              }
            }, res.delay || 200)
          }
        }
        // 设置了timeout时候，发现没有factory.resolved，就reject一个错误
        if (isDef(res.timeout)) {
          timerTimeout = setTimeout(() => {
            timerTimeout = null
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    return factory.loading
      ? factory.loadingComp
      : factory.resolved
  }
}
