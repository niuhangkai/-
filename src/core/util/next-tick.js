/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

function flushCallbacks () {
  pending = false
  const copies = callbacks.slice(0)
  callbacks.length = 0
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// 优先检测是否自持Promise，支持的话使用 Promise 注册 microtask
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
  timerFunc = () => {
    // 注册 microtask 微任务
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    // 在一些 UIWebViews 中存在很奇怪的问题，即 microtask 没有被刷新，对于这个问题的解决方案就是让浏览做一些其他的事情
    // 比如注册一个 (macro)task 即使这个 (macro)task 什么都不做，这样就能够间接触发 microtask 的刷新。
    if (isIOS) setTimeout(noop)
  }
  // 标志位
  isUsingMicroTask = true
  //
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // 在没有原生Promise的地方使用MutationObserver
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // setImmediate 只有IE以及Node.js 0.10+实现了该方法
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // Fallback to setTimeout.
  // setTimeout是作为宏任务最后的备选方案
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}
// nextTick的实现，$nextTick就是对它的封装
/**
 * 这里需要理解调用栈、任务队列、事件循环，javascript 是一种单线程的语言，它的一切都是建立在以这三个概念为基础之上的
 *
 *js的任务分为两类，同步任务以及异步任务（微任务(Microtasks)、宏任务(task)）
 *
 *
 *js异步执行:遇到宏任务，先执行宏任务，宏任务放入event queue（事件队列），然后在执行微任务，微任务执行
 *
 *而宏任务一般是：包括整体代码script，setTimeout，setInterval、setImmediate。

  微任务：原生Promise(有些实现的promise将then方法放到了宏任务中)、process.nextTick、Object.observe(已废弃)、 MutationObserver 记住就行了

  setTimeout(() => {},1000) 异步任务中的延时不是定时执行，而是多长时间加入到主线程执行

  setTimeout(fn,0)的含义是，指定某个任务在主线程最早可得的空闲时间执行，意思就是不用再等多少秒了，只要主线程执行栈内的同步任务全部执行完成，栈为空就马上执行。
  ps:(即便主线程为空，0毫秒实际上也是达不到的。根据HTML的标准，最低是4毫秒)



  setInterval(() =>{},1000) setInterval会每隔指定的时间将注册的函数置入Event Queue，如果前面的任务耗时太久，那么同样需要等待
  每过ms秒，会有fn进入Event Queue。一旦setInterval的回调函数fn执行时间超过了延迟时间ms，那么就完全看不出来有时间间隔了

  整个script也是作为一个整体的宏任务存在，执行完之后在执行微任务，在进入下一次宏任务的循环

  宏任务(微任务)-UI渲染-宏任务(微任务)
  先执行宏任务，在执行微任务 渲染UI 在进入下一次的事件循环


  new Promise是同步任务，.then是异步任务


 */
// cb flushSchedulerQueue()
export function nextTick (cb?: Function, ctx?: Object) {
  let _resolve
  // 将cb添加到一个函数当中，此时回调函数并没有被执行
  callbacks.push(() => {
    if (cb) {
      try {
        // 设置作用于为ctx
        cb.call(ctx)
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
    } else if (_resolve) {
      _resolve(ctx)
    }
  })
  // 代表回调队列是否处于等待刷新的状态
  if (!pending) {
    pending = true
    timerFunc()
  }
  // $flow-disable-line
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
