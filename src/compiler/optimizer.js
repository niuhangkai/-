/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
// 传入ast
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  // 第一步，标记静态节点，只有当前根节点以及其所有子节点都是静态的，才是一个静态的
  // type 为 1 表示是普通元素，为 2 表示是表达式，为 3 表示是纯文本或者注释节点。
  /**
   * 处理完成之后
   * [{
   *   children:[{tag:'div',static:true},{tag:'li',static:false}]
   * static:false
   * }]
   */
  markStatic(root)
  // second pass: mark static roots.
  // 第二步，标记静态根节点
  markStaticRoots(root, false)
}
// 静态节点的key，eg: "staticClass,staticStyle"
function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

function markStatic (node: ASTNode) {
  // 获取到ast中的静态节点
  node.static = isStatic(node)
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      // 不是平台保留标签，说明是一个组件
      // 这几种情况都是动态的，不能标记为静态节点
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 递归对子ast做遍历执行markStatic
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) {
        // 只要其中一个子节点不是static，整个节点都不会标记为static
        // 由其子节点来决定是不是一个static
        node.static = false
      }
    }
    // 如果有v-if的条件Conditions的ast
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block
        // block也是ast，就是当前写判断条件的那个ast
        markStatic(block)
        // 和上面一样，block.static不存在，整个node的static为false
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

// isInFor是表示当前节点是不是在v-for的指令里面，根节点为false
// 作用就是标记当前ast以及其子元素是不是一个staticRoot
function markStaticRoots (node: ASTNode, isInFor: boolean) {
  // 对当前是元素节点时候
  if (node.type === 1) {
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // 是一个节点成为静态根节点，应该具有以下子节点
    // For a node to qualify as a static root, it should have children that
    // 把一个纯文本节点标记为静态节点，成本大于收益
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 是静态节点  并且  存在子节点 并且子节点长度大于1也不是纯文本节点 标记静态根为true
    // 只要node.static为true，整个其子节点都是static
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      // 设置一个标记为staticRoot静态根为true
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    // 递归调用处理子节点
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    // 递归调用处理条件判断中的block
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}
// type 为 1 表示是普通元素，为 2 表示是表达式，为 3 表示是纯文本或者注释节点
function isStatic (node: ASTNode): boolean {
  if (node.type === 2) { // expression
    return false
  }
  if (node.type === 3) { // text
    return true
  }
  // 其余情况，也就是node.type为1的情况
  // 判断条件为pre也是静态的
  // 不能有bindings，if，v-for，不能有slot等这些内部组件，
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}

function isDirectChildOfTemplateFor (node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
