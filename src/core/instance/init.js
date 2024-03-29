/* @flow */

import config from "../config";
import { initProxy } from "./proxy";
import { initState } from "./state";
import { initRender } from "./render";
import { initEvents } from "./events";
import { mark, measure } from "../util/perf";
import { initLifecycle, callHook } from "./lifecycle";
import { initProvide, initInjections } from "./inject";
import { extend, mergeOptions, formatComponentName } from "../util/index";
import { compile } from "../../platforms/web/compiler";

let uid = 0;

export function initMixin(Vue: Class<Component>) {
  // 注意：如果这里是组件初始化的话
  /**
   * options中的_isComponent会被设置为true
   * options中的_parentVnode就是当前App的vnode
   * options中的parent 就是app = new Vue()实例
   * 组件会通过src/core/vdom/create-component.js中的init钩子，执行createComponentInstanceForVnode方法
   *
   * const options: InternalComponentOptions = {
    // 标识位，这里在重新初始化Vue时候会用到做判断
    _isComponent: true,
    // 占位符节点
    _parentVnode: vnode,
    // app = new Vue()
    parent,
  };
  // 初始化通过创建组件new vnode中的componentOptions执行init
  return new vnode.componentOptions.Ctor(options);
   */

  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this;
    // a uid
    vm._uid = uid++;

    let startTag, endTag;
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`;
      endTag = `vue-perf-end:${vm._uid}`;
      mark(startTag);
    }

    // a flag to avoid this being observed
    vm._isVue = true;
    // merge options
    // 在create-component文件中的createComponentInstanceForVnode 方法设置了_isComponent 为 true
    // 组件的合并策略
    if (options && options._isComponent) {
      // 组件会执行这里的逻辑
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      // 初始化组件
      initInternalComponent(vm, options);
    } else {
      // 普通节点的合并策略
      // 可以在页面中通过this.$options访问到options
      vm.$options = mergeOptions(
        // 这里会返回一个Vue的options
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      );
    }
    /* istanbul ignore else */
    // 对属性做一层代理，没有的话会报key is not defined on the instance but referenced during render...
    // 另外提示不能使用$或者_开头的key
    if (process.env.NODE_ENV !== "production") {
      initProxy(vm);
    } else {
      vm._renderProxy = vm;
    }
    // expose real self
    vm._self = vm;
    //  对vue实例一些属性进行赋值,比如$parent,$children,$refs,$root等
    initLifecycle(vm);
    // 初始化实例的事件系统,事件即包括使用v-on或@注册的自定义事件
    initEvents(vm);
    // 初始化模板,为组件上$slots、$scopeSlots、$createElement、$attrs、$listeners赋值
    initRender(vm);
    // 执行beforeCreate钩子函数
    callHook(vm, "beforeCreate");
    // 初始化注入处理inject  resolve injections before data/props
    initInjections(vm); // resolve injections before data/props
    // 初始化双向数据绑定、props、data、methods、watch、computed，等属性
    initState(vm);
    // 初始化注入处理provide   resolve provide after data/props
    initProvide(vm); // resolve provide after data/props
    callHook(vm, "created");

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      vm._name = formatComponentName(vm, false);
      mark(endTag);
      measure(`vue ${vm._name} init`, startTag, endTag);
    }
    // 组件实例化没有el，不会执行这里。组件会手动调用$mount
    if (vm.$options.el) {
      vm.$mount(vm.$options.el);
    }
  };
}
// 如果在Vue中初始化执行的的init函数中，判断到是一个组件，会执行这里的
export function initInternalComponent(
  vm: Component,
  options: InternalComponentOptions
) {
  const opts = (vm.$options = Object.create(vm.constructor.options));
  // doing this because it's faster than dynamic enumeration.
  // 获取在create-components文件中传入的参数
  /**
   * 224-229
   * const options: InternalComponentOptions = {
      // 标识位
      _isComponent: true,
      _parentVnode: vnode,
      parent // 当前vm实例
    }
   */
  /**
   * options中的_isComponent会被设置为true
   * options中的_parentVnode就是当前App的vnode
   * options中的parent 就是app = new Vue()实例
   * 组件会通过src/core/vdom/create-component.js中的init钩子，执行createComponentInstanceForVnode方法
   */
  const parentVnode = options._parentVnode;
  opts.parent = options.parent;
  opts._parentVnode = parentVnode;
  // 初始化了一系列属性
  const vnodeComponentOptions = parentVnode.componentOptions;
  opts.propsData = vnodeComponentOptions.propsData;
  // 将父组件的事件传递给子组件，这样自定义事件才能获取到对应的执行函数
  opts._parentListeners = vnodeComponentOptions.listeners;
  opts._renderChildren = vnodeComponentOptions.children;
  opts._componentTag = vnodeComponentOptions.tag;

  if (options.render) {
    opts.render = options.render;
    opts.staticRenderFns = options.staticRenderFns;
  }
}

export function resolveConstructorOptions(Ctor: Class<Component>) {
  let options = Ctor.options;
  if (Ctor.super) {
    const superOptions = resolveConstructorOptions(Ctor.super);
    const cachedSuperOptions = Ctor.superOptions;
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions;
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor);
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions);
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions);
      if (options.name) {
        options.components[options.name] = Ctor;
      }
    }
  }
  return options;
}

function resolveModifiedOptions(Ctor: Class<Component>): ?Object {
  let modified;
  const latest = Ctor.options;
  const sealed = Ctor.sealedOptions;
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {};
      modified[key] = latest[key];
    }
  }
  return modified;
}
