/* @flow */

import {
  warn,
  nextTick,
  emptyObject,
  handleError,
  defineReactive,
} from "../util/index";

import { createElement } from "../vdom/create-element";
import { installRenderHelpers } from "./render-helpers/index";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import VNode, { createEmptyVNode } from "../vdom/vnode";

import { isUpdatingChildComponent } from "./lifecycle";

export function initRender(vm: Component) {
  vm._vnode = null; // the root of the child tree
  vm._staticTrees = null; // v-once cached trees
  const options = vm.$options;
  const parentVnode = (vm.$vnode = options._parentVnode); // the placeholder node in parent tree
  const renderContext = parentVnode && parentVnode.context;
  vm.$slots = resolveSlots(options._renderChildren, renderContext);
  vm.$scopedSlots = emptyObject;
  // bind the createElement fn to this instance
  // so that we get proper render context inside it.
  // args order: tag, data, children, normalizationType, alwaysNormalize
  // internal version is used by render functions compiled from templates
  // 通过编译template的给最后传递一个false
  // vm当前实例，a是tag。b是VNode数组（后面会normalize，处理为第三个参数），c是children
  vm._c = (a, b, c, d) => createElement(vm, a, b, c, d, false);
  // normalization is always applied for the public version, used in
  // user-written render functions.
  // 用户手写的render函数最后会为true
  vm.$createElement = (a, b, c, d) => createElement(vm, a, b, c, d, true);

  // $attrs & $listeners are exposed for easier HOC creation.
  // they need to be reactive so that HOCs using them are always updated
  const parentData = parentVnode && parentVnode.data;

  /* istanbul ignore else */
  if (process.env.NODE_ENV !== "production") {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$attrs is readonly.`, vm);
      },
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$listeners is readonly.`, vm);
      },
      true
    );
  } else {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      null,
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      null,
      true
    );
  }
}

export let currentRenderingInstance: Component | null = null;

// for testing only
export function setCurrentRenderingInstance(vm: Component) {
  currentRenderingInstance = vm;
}

export function renderMixin(Vue: Class<Component>) {
  // install runtime convenience helpers
  installRenderHelpers(Vue.prototype);

  Vue.prototype.$nextTick = function (fn: Function) {
    return nextTick(fn, this);
  };

  Vue.prototype._render = function (): VNode {

    const vm: Component = this;
    // _parentVnode 为组件中的_parentVnode
    /**
     *  组件init 钩子执行
       export function createComponentInstanceForVnode(
       const options: InternalComponentOptions = {
          // 标识位
          _isComponent: true,
          _parentVnode: vnode,
          parent
         }
        )
     */
    const { render, _parentVnode } = vm.$options;
    if (_parentVnode) {
      vm.$scopedSlots = normalizeScopedSlots(
        _parentVnode.data.scopedSlots,
        vm.$slots,
        vm.$scopedSlots
      );
    }

    // set parent vnode. this allows render functions to have access
    // to the data on the placeholder node.
    // 占位符VNode，父VNode
    vm.$vnode = _parentVnode;
    // render self
    let vnode;
    try {
      // There's no need to maintain a stack because all render fns are called
      // separately from one another. Nested component's render fns are called
      // when parent component is patched.
      currentRenderingInstance = vm;
      // 拿到createElement创建返回的VNode,render是用户手写的或者通过compilerToFunction生成的
      // render函数里面会调用_c方法，也就是vm.$createElemen这个函数作为参数
      vnode = render.call(vm._renderProxy, vm.$createElement);
    } catch (e) {
      handleError(e, vm, `render`);
      // return error render result,
      // or previous vnode to prevent render error causing blank component
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== "production" && vm.$options.renderError) {
        try {
          vnode = vm.$options.renderError.call(
            vm._renderProxy,
            vm.$createElement,
            e
          );
        } catch (e) {
          handleError(e, vm, `renderError`);
          vnode = vm._vnode;
        }
      } else {
        vnode = vm._vnode;
      }
    } finally {
      currentRenderingInstance = null;
    }
    // if the returned array contains only a single node, allow it
    if (Array.isArray(vnode) && vnode.length === 1) {
      vnode = vnode[0];
    }
    // 只能有一个模板节点
    // return empty vnode in case the render function errored out
    if (!(vnode instanceof VNode)) {
      if (process.env.NODE_ENV !== "production" && Array.isArray(vnode)) {
        warn(
          "Multiple root nodes returned from render function. Render function " +
            "should return a single root node.",
          vm
        );
      }
      vnode = createEmptyVNode();
    }
    // set parent
    // 如果是组件实例话过程中_parentVnode就是App.vue  render生成的是App.vue里面具体的dom
    vnode.parent = _parentVnode;
    return vnode;
  };
}
