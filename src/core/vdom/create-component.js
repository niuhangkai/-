/* @flow */

import VNode from "./vnode";
import { resolveConstructorOptions } from "core/instance/init";
import { queueActivatedComponent } from "core/observer/scheduler";
import { createFunctionalComponent } from "./create-functional-component";

import { warn, isDef, isUndef, isTrue, isObject } from "../util/index";

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData,
} from "./helpers/index";

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent,
} from "../instance/lifecycle";

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate,
} from "weex/runtime/recycle-list/render-component-template";

// inline hooks to be invoked on component VNodes during patch
// 组件的hook
const componentVNodeHooks = {
  // 组件VNode，这里的init在update的patch过程中，会执行createComponent，也就是vnode.data.init()
  init(vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      // keep-alive相关
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode; // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode);
    } else {
      // 返回vm实例
      const child = (vnode.componentInstance = createComponentInstanceForVnode(
        // App对象,占位符组件VNode
        vnode,
        // 这里的activeInstance 是一个全局变量，定义在initLifecycle.js中。
        // 在lifecycleMixin方法执行时候通过setActiveInstance方法赋值为当前的vm
        // 初次执行时候就是通过let app = new Vue()出来的对象
        activeInstance
      ));
      // 执行完各种实例化之后
      // 手动mount
      // entry-runtime-with-compiler 中的$mount方法
      child.$mount(hydrating ? vnode.elm : undefined, hydrating);
    }
  },
  // 这里在patch过程中，比对vnode为相同vnode的patch时候
  prepatch(oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions;
    const child = (vnode.componentInstance = oldVnode.componentInstance);
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    );
  },

  insert(vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode;
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true;
      callHook(componentInstance, "mounted");
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance);
      } else {
        activateChildComponent(componentInstance, true /* direct */);
      }
    }
  },

  destroy(vnode: MountedComponentVNode) {
    const { componentInstance } = vnode;
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy();
      } else {
        deactivateChildComponent(componentInstance, true /* direct */);
      }
    }
  },
};
// hooksToMerge：[init,prepatch,insert,destroy]
const hooksToMerge = Object.keys(componentVNodeHooks);

export function createComponent(
  // 组件类型 可以是组件类、函数、对象
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  // vm实例 上下文
  context: Component,
  // 子Vnode
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return;
  }
  // 这里是vm.$options._base
  // Vue.prototype._base = Vue  global-api下的初始化
  // 这里的baseCtor就是Vue的入口函数，Vue(options)
  const baseCtor = context.$options._base;

  // plain options object: turn it into a constructor
  // 如果是对象
  /**
   * {template:"<div>123</div>"}
   */
  // 如果这里是通过Vue.components全局注册的，name这里不会执行，因为Vue.components方法已经执行了extend
  // 异步组件不满足，不会执行这里的逻辑
  if (isObject(Ctor)) {
    // Vue.extend global-api下的extend 把对象转成构造器 src\core\global-api\extend.js
    Ctor = baseCtor.extend(Ctor);
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  /**
   * 如果是上面extend处理过的，会返回Ctor =
   * function VueComponent (options) {
        this._init(options);
      };
   */
  if (typeof Ctor !== "function") {
    if (process.env.NODE_ENV !== "production") {
      warn(`Invalid Component definition: ${String(Ctor)}`, context);
    }
    return;
  }

  // async component
  let asyncFactory;
  // 异步组件，异步组件函数不存在cid，执行下面逻辑
  if (isUndef(Ctor.cid)) {
    // 异步组件的ctor是函数
    asyncFactory = Ctor;
    // baseCtor 是Vue
    // src\core\vdom\helpers\resolve-async-component.js
    // 工厂函数第一次返回undefined
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor);
    if (Ctor === undefined) {
      // ctor是undefined时候返回
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      // 这个方法创建了一个空的异步vnode返回
      return createAsyncPlaceholder(asyncFactory, data, context, children, tag);
    }
  }

  data = data || {};

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  // 重新计算一些options
  resolveConstructorOptions(Ctor);

  // transform component v-model data into props & events
  // 和v-model相关
  if (isDef(data.model)) {
    transformModel(Ctor.options, data);
  }

  // extract props
  // 对props的处理
  const propsData = extractPropsFromVNodeData(data, Ctor, tag);

  // functional component
  // 函数式组件的处理
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children);
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners
  // 自定义事件的处理
  // 在ast创建过程中，会把原生的.native修饰符的添加为nativeOn，普通事件为on这里做了修改，在on上面页添加了
  // on可能是自定义事件，nativeOn是原生事件，自定义事件赋值给了listeners
  const listeners = data.on;
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.
  data.on = data.nativeOn;

  // 抽象组件
  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot;
    data = {};
    if (slot) {
      data.slot = slot;
    }
  }

  // install component management hooks onto the placeholder node
  // 安装组件钩子
  // 在patch过程中也会安装一系列create，destroy等钩子，和那个类似
  /**
   * data = {
   * hook:init(),
   * destroy:destroy(),
   * prepatch:prepatch(),
   * insert:insert() //这里会执行mounted钩子
   * }
   *
   */
  installComponentHooks(data);

  // return a placeholder vnode
  const name = Ctor.options.name || tag;
  // 生成组件VNode。和普通组件不一样，多一个componentOptions,另外没有children，名字被标记为vue-component
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ""}`,
    data,
    undefined,
    undefined,
    undefined,
    context,
    // 这些参数是VNode中的componentOption，vnode中的componentOption.Ctor就是上面继承创建的Sub，组件构造函数，下面在组件的init钩子中，会执行createComponentInstanceForVnode方法，会通过new vnode.componentOptions.Ctor(options)调用执行
    // 在vnode中this.componentOption = componentOption
    // componentOption = {Ctor, propsData, listeners, tag, children}
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  );

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode);
  }

  return vnode;
}

// init 钩子执行
export function createComponentInstanceForVnode(
  vnode: any, // we know it's MountedComponentVNode but flow doesn't // 当前组件vnode
  parent: any // activeInstance in lifecycle state //当前vm实例  let app = new Vue() activeInstance
): Component {
  // 定义options
  const options: InternalComponentOptions = {
    // 标识位，这里在重新初始化Vue时候会用到做判断
    _isComponent: true,
    // 占位符节点
    _parentVnode: vnode,
    // app = new Vue()
    parent,
  };
  // check inline-template render functions
  const inlineTemplate = vnode.data.inlineTemplate;
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render;
    options.staticRenderFns = inlineTemplate.staticRenderFns;
  }
  // 在这里执行了通过Vue.extend拓展的Sub的构造函数 200行，创建组件VNode时候把构造器保存在了componentOptions中，初始化这个构造函数，就会重新执行Vue.init中的方法，重新去初始化组件
  // options的_parentVnode是当前App，组件VNode，parent就是当前app = new Vue()返回的实例
  return new vnode.componentOptions.Ctor(options);
}

function installComponentHooks(data: VNodeData) {
  //
  const hooks = data.hook || (data.hook = {});
  // 组件内的钩子，所有组件都有 init prepatch insert... componentVNodeHooks函数
  for (let i = 0; i < hooksToMerge.length; i++) {
    const key = hooksToMerge[i];
    const existing = hooks[key];
    const toMerge = componentVNodeHooks[key];
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge;
    }
  }
}

function mergeHook(f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b);
    f2(a, b);
  };
  merged._merged = true;
  return merged;
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
function transformModel(options, data: any) {
  const prop = (options.model && options.model.prop) || "value";
  const event = (options.model && options.model.event) || "input";
  (data.attrs || (data.attrs = {}))[prop] = data.model.value;
  const on = data.on || (data.on = {});
  const existing = on[event];
  const callback = data.model.callback;
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing);
    }
  } else {
    on[event] = callback;
  }
}
