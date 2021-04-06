/* @flow */

import config from '../config'
import VNode, { createEmptyVNode } from './vnode'
import { createComponent } from './create-component'
import { traverse } from '../observer/traverse'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject,
  isPrimitive,
  resolveAsset
} from '../util/index'

import {
  normalizeChildren,
  simpleNormalizeChildren
} from './helpers/index'

const SIMPLE_NORMALIZE = 1
const ALWAYS_NORMALIZE = 2

// wrapper function for providing a more flexible interface
// without getting yelled at by flow
export function createElement (
  // VNode实例
  context: Component,
  // tag标签
  tag: any,
  // VNode相关的数据
  data: any,
  // 子VNode
  children: any,
  normalizationType: any,
  alwaysNormalize: boolean
): VNode | Array<VNode> {
  // export function isPrimitive (value: any): boolean % checks {
  //   // 是不是基础数据类型
  //   return (
  //     typeof value === 'string' ||
  //     typeof value === 'number' ||
  //     // $flow-disable-line
  //     typeof value === 'symbol' ||
  //     typeof value === 'boolean'
  //   )
  // }
  if (Array.isArray(data) || isPrimitive(data)) {
    // 参数重载，对参数进行检测，因为data可以是空的
    normalizationType = children
    children = data
    data = undefined
  }
  if (isTrue(alwaysNormalize)) {
    // 如果是用户手写的render函数 type为2
    normalizationType = ALWAYS_NORMALIZE
  }
  return _createElement(context, tag, data, children, normalizationType)
}

export function _createElement (
  context: Component,
  tag?: string | Class<Component> | Function | Object,
  data?: VNodeData,
  children?: any,
  normalizationType?: number
): VNode | Array<VNode> {
  // 这里的vnode不能是一个响应式的，否则返回一个注释节点
  if (isDef(data) && isDef((data: any).__ob__)) {
    process.env.NODE_ENV !== 'production' && warn(
      `Avoid using observed data object as vnode data: ${JSON.stringify(data)}\n` +
      'Always create fresh vnode data objects in each render!',
      context
    )
    // 创建空的VNode实例
    return createEmptyVNode()
  }
  // object syntax in v-bind
  // 这里是和component:is相关的内容
  if (isDef(data) && isDef(data.is)) {
    tag = data.is
  }
  // 如果是false，那么就会返回一个空的注释节点
  if (!tag) {
    // in case of component :is set to falsy value
    //
    return createEmptyVNode()
  }
  // warn against non-primitive key
  // 非原始类型警告处理isPrimitive方法
  if (process.env.NODE_ENV !== 'production' &&
    isDef(data) && isDef(data.key) && !isPrimitive(data.key)
  ) {
    if (!__WEEX__ || !('@binding' in data.key)) {
      warn(
        'Avoid using non-primitive value as key, ' +
        'use string/number value instead.',
        context
      )
    }
  }
  // support single function children as default scoped slot
  if (Array.isArray(children) &&
    typeof children[0] === 'function'
  ) {
    data = data || {}
    data.scopedSlots = { default: children[0] }
    children.length = 0
  }
  // 对所有的children做normalize，变成一层的数组
  if (normalizationType === ALWAYS_NORMALIZE) {
    // 如果是用户手写的render
    children = normalizeChildren(children)
  } else if (normalizationType === SIMPLE_NORMALIZE) {
    // 只有一层深度的可以用这种方法
    children = simpleNormalizeChildren(children)
  }
  let vnode, ns
  // 如果tag是string 比如div
  if (typeof tag === 'string') {
    let Ctor
    // ns是name space的处理
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag)
    if (config.isReservedTag(tag)) {
      // 是不是原生的保留标签config.isReservedTag方法
      // platform built-in elements
      if (process.env.NODE_ENV !== 'production' && isDef(data) && isDef(data.nativeOn)) {
        warn(
          `The .native modifier for v-on is only valid on components but it was used on <${tag}>.`,
          context
        )
      }
      vnode = new VNode(
        config.parsePlatformTagName(tag), data, children,
        undefined, undefined, context
      )
    } else if ((!data || !data.pre) && isDef(Ctor = resolveAsset(context.$options, 'components', tag))) {
      // component
      // 解析出来是一个组件,通过resolveAsset方法解析，assets在src\core\global-api\assets.js下面挂载到了this.$options中
      // createElement('h1', ['一则头条1',createElement('my-component-a')]) 创建组件这种情况会执行这个
      vnode = createComponent(Ctor, data, context, children, tag)
    } else {
      // 未知节点
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
      vnode = new VNode(
        tag, data, children,
        undefined, undefined, context
      )
    }
  } else {
    // 如果tag是一个组件对象 render(h) => h(App)
    // direct component options / constructor
    vnode = createComponent(tag, data, context, children)
  }
  if (Array.isArray(vnode)) {
    return vnode
  } else if (isDef(vnode)) {
    if (isDef(ns)) applyNS(vnode, ns)
    if (isDef(data)) registerDeepBindings(data)
    return vnode
  } else {
    return createEmptyVNode()
  }
}

function applyNS (vnode, ns, force) {
  vnode.ns = ns
  if (vnode.tag === 'foreignObject') {
    // use default namespace inside foreignObject
    ns = undefined
    force = true
  }
  if (isDef(vnode.children)) {
    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const child = vnode.children[i]
      if (isDef(child.tag) && (
        isUndef(child.ns) || (isTrue(force) && child.tag !== 'svg'))) {
        applyNS(child, ns, force)
      }
    }
  }
}

// ref #5318
// necessary to ensure parent re-render when deep bindings like :style and
// :class are used on slot nodes
function registerDeepBindings (data) {
  if (isObject(data.style)) {
    traverse(data.style)
  }
  if (isObject(data.class)) {
    traverse(data.class)
  }
}
