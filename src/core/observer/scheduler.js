/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

// 渲染队列数组
const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
// 记录是否重复
let has: { [key: number]: ?true } = {}
// 循环更新
let circular: { [key: number]: number } = {}
// 标志位
let waiting = false
// 标志位，开始更新会把flushing设置为true
let flushing = false
// 当前watcher的索引
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  // 每次执行完flushSchedulerQueue重置
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 */
function flushSchedulerQueue () {
  currentFlushTimestamp = getNow()
  flushing = true
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  // 排序，有三种情况需要排序
//   1.组件的更新由父到子；因为父组件的创建过程是先于子的，所以 watcher 的创建也是先父后子，执行顺序也应该保持先父后子。

// 2.用户的自定义 watcher 要优先于渲染 watcher 执行；因为用户自定义 watcher 是在渲染 watcher 之前创建的。

// 3.如果一个组件在父组件的 watcher 执行期间被销毁，那么它对应的 watcher 执行都可以被跳过，所以父组件的 watcher 应该先执行
// 这里的queue在下面queueWatcher时候会push进来
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  // 这里不queue做缓存的原因是queue的长度随时会变
  for (index = 0; index < queue.length; index++) {
    // 获取到每一个watcher
    watcher = queue[index]
    // 存在before则执行
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    // 在执行watcher.run()方法时候，会再次访问queueWatcher，可能会改变queue长度的情况
    watcher.run()
    // in dev build, check and stop circular updates.
    // 如果存在无限循环更新的情况做判断
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  // 每次执行完flushSchedulerQueue重置
  resetSchedulerState()

  // call component updated and activated hooks
  // 给keep-alive钩子函数使用
  callActivatedHooks(activatedQueue)
  // 执行更新的钩子函数
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  // 给开发工具使用
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    // 这里的_watcher表示是一个渲染watcher，如果是渲染watcher，&&挂载了&&没有被销毁
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      // 已经被挂载，但是没有被销毁，执行updated钩子函数
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
// 将观察者放入队列中
export function queueWatcher (watcher: Watcher) {
  // Watcher创建时候唯一id
  const id = watcher.id
  // has用来记录队列中的Watcher，防止重复搜集
  if (has[id] == null) {
    has[id] = true
    // 标志位，开始更新会把flushing设置为true。此处表示队列正在执行更新
    if (!flushing) {
      // 入队操作
      queue.push(watcher)
    } else {
      // 在执行flushSchedulerQueue()里面的watcher.run()方法时候，会执行到这里
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      // 获取到queue最后一位,index为当前遍历到哪一个的索引
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    // 保证只执行一次
    if (!waiting) {
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      // nextTict相当于setTimeout(() => {},0),但是setTimeout并不是最优选择
      // setTimeout是宏任务，宏任务包含了微任务。所以通过nextTick把数据更新放在微任务中
      // 相当于setTimeout(flushSchedulerQueue, 0)，但是nextTick是微任务，setTimeout是宏任务
      // 下一次事件循环立即执行flushSchedulerQueue函数
      nextTick(flushSchedulerQueue)
    }
  }
}
