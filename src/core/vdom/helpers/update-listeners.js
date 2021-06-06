/* @flow */

import { warn, invokeWithErrorHandling } from "core/util/index";
import { cached, isUndef, isTrue, isPlainObject } from "shared/util";
// 格式化事件名
// eg：name=click
const normalizeEvent = cached((name: string): {
  name: string,
  once: boolean,
  capture: boolean,
  passive: boolean,
  handler?: Function,
  params?: Array<any>,
} => {
  // 截取到事件名第一个字符
  const passive = name.charAt(0) === "&";
  name = passive ? name.slice(1) : name;
  const once = name.charAt(0) === "~"; // Prefixed last, checked first
  name = once ? name.slice(1) : name;
  const capture = name.charAt(0) === "!";
  name = capture ? name.slice(1) : name;
  return {
    name,
    once,
    capture,
    passive,
  };
});

export function createFnInvoker(
  // fns，当前事件对应的函数，可以是一个数组
  fns: Function | Array<Function>,
  vm: ?Component
): Function {
  // 执行事件最终执行的函数
  function invoker() {
    // 获取到当前事件函数
    const fns = invoker.fns;
    if (Array.isArray(fns)) {
      // 数组的话遍历执行
      const cloned = fns.slice();
      for (let i = 0; i < cloned.length; i++) {
        invokeWithErrorHandling(cloned[i], null, arguments, vm, `v-on handler`);
      }
    } else {
      // return handler return value for single handlers
      // 单个函数的话直接执行，执行我们自己定义的函数
      return invokeWithErrorHandling(fns, null, arguments, vm, `v-on handler`);
    }
  }
  // 给当前函数挂载了一个静态函数fns,对应的就是我们当前的事件函数
  invoker.fns = fns;
  return invoker;
}
// 事件更新，创建和更新都会执行这里
export function updateListeners(
  // eg：click:{fn()}
  on: Object,
  oldOn: Object,
  add: Function,
  remove: Function,
  createOnceHandler: Function,
  vm: Component
) {
  let name, def, cur, old, event;
  for (name in on) {
    // 获取到新vnode的事件函数 eg：fn($event)
    def = cur = on[name];
    // 获取到老得vnode的事件函数
    old = oldOn[name];
    //格式化之后为
    /**
     * capture: false
      name: "click"
      once: false
      passive: false
     */
    event = normalizeEvent(name);
    /* istanbul ignore if */
    if (__WEEX__ && isPlainObject(def)) {
      cur = def.handler;
      event.params = def.params;
    }
    if (isUndef(cur)) {
      // 没有定义当前事件
      process.env.NODE_ENV !== "production" &&
        warn(
          `Invalid handler for event "${event.name}": got ` + String(cur),
          vm
        );
    } else if (isUndef(old)) {
      // 创建事件逻辑，旧的没有新的有
      if (isUndef(cur.fns)) {
        // 创建新的事件
        // 最后的返回就是createFnInvoker函数的返回值，invoker函数对应的执行事件
        cur = on[name] = createFnInvoker(cur, vm);
      }
      if (isTrue(event.once)) {
        cur = on[name] = createOnceHandler(event.name, cur, event.capture);
      }
      // eg：click   invoker  false         false           false
      add(event.name, cur, event.capture, event.passive, event.params);
    } else if (cur !== old) {
      // 更新事件逻辑
      old.fns = cur;
      on[name] = old;
    }
  }
  for (name in oldOn) {
    if (isUndef(on[name])) {
      event = normalizeEvent(name);
      remove(event.name, oldOn[name], event.capture);
    }
  }
}
