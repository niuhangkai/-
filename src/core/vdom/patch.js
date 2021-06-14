/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */
// Vue是基于Snabbdom的虚拟VNode
import VNode, { cloneVNode } from "./vnode";
import config from "../config";
import { SSR_ATTR } from "shared/constants";
import { registerRef } from "./modules/ref";
import { traverse } from "../observer/traverse";
import { activeInstance } from "../instance/lifecycle";
import { isTextInputType } from "web/util/element";

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive,
} from "../util/index";

export const emptyNode = new VNode("", {}, []);

const hooks = ["create", "activate", "update", "remove", "destroy"];

// 用来比对两个VNode是不是相同，只要满足key相等并且下面两个条件中的任意一个
// 可以复用的相同节点
function sameVnode(a, b) {
  return (
    // 这里的key就是v-for中的写的key值，不推荐采用索引值当做key
    a.key === b.key && // 对比tag是否相等
    ((a.tag === b.tag &&
      //  对比是不是都为注释节点
      a.isComment === b.isComment &&
      // 里面的data是不是都存在(这里的data不是用户传入的data)
      isDef(a.data) === isDef(b.data) &&
      // 是不是都是input类型，并且都具有相同的type
      sameInputType(a, b)) ||
      // 这些条件满足也是相同的vnode
      // 是不是异步占位符节点
      (isTrue(a.isAsyncPlaceholder) &&
        // 都有异步函数
        a.asyncFactory === b.asyncFactory &&
        //
        isUndef(b.asyncFactory.error)))
  );
}

function sameInputType(a, b) {
  if (a.tag !== "input") return true;
  let i;
  // isDef 不为undefined也不为null
  // 如果typeA是input会返回text
  // typeA = true && true && 'text'
  const typeA = isDef((i = a.data)) && isDef((i = i.attrs)) && i.type;
  const typeB = isDef((i = b.data)) && isDef((i = i.attrs)) && i.type;
  return typeA === typeB || (isTextInputType(typeA) && isTextInputType(typeB));
}
// 根据老节点上的key值创建一个对象
function createKeyToOldIdx(children, beginIdx, endIdx) {
  let i, key;
  const map = {};
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key;
    if (isDef(key)) map[key] = i;
  }
  return map;
}

// createPatchFunction 返回一个函数return function patch (oldVnode, vnode, hydrating, removeOnly)
// patch最后会返回一个真实的dom节点，渲染vnode的根节点
export function createPatchFunction(backend) {
  let i, j;
  // 将所有modules模块钩子保留到cbs里面
  /**
   *
   *cbs = {
     create:[(fn updateAttrs(oldVnode, vnode)),(fn updateClass(oldVnode, vnode))],
     update:[(fn updateAttrs(oldVnode, vnode)),(fn updateClass(oldVnode, vnode))],
   }
   */
  /**
   *
   *var hooks = ['create', 'activate', 'update', 'remove', 'destroy'];
   */
  const cbs = {};
  // 获取到modules，nodeOps
  const { modules, nodeOps } = backend;
  // hooks是相当于Snabbdom在patch过程中执行的钩子
  // ['create', 'activate', 'update', 'remove', 'destroy']
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]]);
      }
    }
  }

  function emptyNodeAt(elm) {
    return new VNode(
      nodeOps.tagName(elm).toLowerCase(),
      {},
      [],
      undefined,
      elm
    );
  }

  function createRmCb(childElm, listeners) {
    function remove() {
      if (--remove.listeners === 0) {
        removeNode(childElm);
      }
    }
    remove.listeners = listeners;
    return remove;
  }

  function removeNode(el) {
    const parent = nodeOps.parentNode(el);
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el);
    }
  }

  function isUnknownElement(vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some((ignore) => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag;
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    );
  }

  let creatingElmInVPre = 0;
  // 循环深度优先遍历构建dom树
  function createElm(
    // 生成的VNode
    vnode,
    insertedVnodeQueue,
    parentElm,
    // 参考节点
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      vnode = ownerArray[index] = cloneVNode(vnode);
    }

    vnode.isRootInsert = !nested; // for transition enter check
    // 创建组件VNode,这里是组件在patch过程中执行的逻辑，否则是普通节点的逻辑
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return;
    }
    // 获取vnode中的data
    /**
     * data:{
     * attrs:{id: 'xxx'},
     * },
     * on:{click:f()}
     */
    const data = vnode.data;
    // 获取vnode中的data，就是新增的子节点
    const children = vnode.children;
    // tag 就是div什么的标签名
    const tag = vnode.tag;
    // 如果已经是文本节点，就没有tag
    if (isDef(tag)) {
      if (process.env.NODE_ENV !== "production") {
        if (data && data.pre) {
          creatingElmInVPre++;
        }
        // 对当前vnode做一个检测，使用没有注册的组件会报这个错
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            "Unknown custom element: <" +
              tag +
              "> - did you " +
              "register the component correctly? For recursive components, " +
              'make sure to provide the "name" option.',
            vnode.context
          );
        }
      }
      // 创建了一个dom给到vnode，相当于创建一个组件节点
      vnode.elm = vnode.ns
        ? // 创建一个具有指定的命名空间URI和限定名称的元素
          /**
           * document.createElementNS
           */
          nodeOps.createElementNS(vnode.ns, tag)
        : // 原生api创建
          /**
           * document.createElement(tagName)
           */
          nodeOps.createElement(tag, vnode);
      // 设置css作用域
      setScope(vnode);

      /* istanbul ignore if */
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree);
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue);
          }
          insert(parentElm, vnode.elm, refElm);
        }
        createChildren(vnode, children, insertedVnodeQueue);
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue);
          }
          insert(parentElm, vnode.elm, refElm);
        }
      } else {
        // 如果VNode有子节点，就先创建子节点，插入顺序，先子后父
        // 那就循环遍历调用createElm方法，把当前的vnode.elm作为父节点传入
        // 先执行的createChildren，所以子节点的insert会先执行
        createChildren(vnode, children, insertedVnodeQueue);

        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue);
        }
        // 原生insert封装，将vnode.elm，也就是通过nodeOps.createElement(tag, vnode)创建的dom
        // 先执行上面的createChildren创建子元素，在insert到父节点中
        insert(parentElm, vnode.elm, refElm);
      }

      if (process.env.NODE_ENV !== "production" && data && data.pre) {
        creatingElmInVPre--;
      }
      // 如果是注释节点，创建注释节点
    } else if (isTrue(vnode.isComment)) {
      vnode.elm = nodeOps.createComment(vnode.text);
      insert(parentElm, vnode.elm, refElm);
    } else {
      // 否则创建文本节点
      vnode.elm = nodeOps.createTextNode(vnode.text);
      insert(parentElm, vnode.elm, refElm);
    }
  }

  // 创建组件
  // vnode是组件vnode，比如App对象
  function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    /**
      data:{
        hook:{
          destroy:fn(),
          init:fn(),
          instrt:fn()
        },
        on:undefined
      }
       */
    let i = vnode.data;
    // 判断data是否存在
    if (isDef(i)) {
      // keep-alive相关，这里vnode是当前keepAlive中的子组件，因为在keep-alive中。是通过
      // vnode = this.$slot.default获取的vnode，然后vnode把的vnode.data.keepAlive置为true
      // 这里第一次vnode.componentInstance实例还不存在，解析到keep-alive组件时候，会获取到下面第一个子组件的实例，设置keepAlive为true
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive;
      // 这里判断了一下是否存在init钩子，存在的话执行组件的init钩子
      if (isDef((i = i.hook)) && isDef((i = i.init))) {
        // 调用data中的hook 在创建组件时候执行的安装方法installComponentHooks(data) src\core\vdom\create-component.js
        // 传入当前vnode    create-component.js  36行开始，组件的钩子
        i(vnode, false /* hydrating */);
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        initComponent(vnode, insertedVnodeQueue);
        // 节点插入，子元素向父元素中插入
        insert(parentElm, vnode.elm, refElm);
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm);
        }
        return true;
      }
    }
  }

  function initComponent(vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(
        insertedVnodeQueue,
        vnode.data.pendingInsert
      );
      vnode.data.pendingInsert = null;
    }
    // 返回给helloWorld占位符节点，vnode.componentInstance.$el实是__PATCH__生成的渲染真实dom
    vnode.elm = vnode.componentInstance.$el;
    if (isPatchable(vnode)) {
      invokeCreateHooks(vnode, insertedVnodeQueue);
      setScope(vnode);
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode);
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode);
    }
  }

  function reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i;
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode;
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode;
      if (isDef((i = innerNode.data)) && isDef((i = i.transition))) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode);
        }
        insertedVnodeQueue.push(innerNode);
        break;
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm);
  }
  // 插入节点操作
  // ref是参考节点
  function insert(parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          // 原生的insertBefore方法
          // 在指定的已有子节点之前插入新的子节点
          nodeOps.insertBefore(parent, elm, ref);
        }
      } else {
        // 原生的appendChild
        // 向节点添加最后一个子节点
        nodeOps.appendChild(parent, elm);
      }
    }
  }
  // 创建子节点
  function createChildren(vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {
      // 如果子节点是一个数组，那就循环遍历调用createElm方法，把当前的vnode.elm作为父节点传入
      if (process.env.NODE_ENV !== "production") {
        // 对key做一层校验
        checkDuplicateKeys(children);
      }
      for (let i = 0; i < children.length; ++i) {
        // 递归调用createElm创建子节点，深度优先遍历，先子后父
        createElm(
          children[i],
          insertedVnodeQueue,
          vnode.elm,
          null,
          true,
          children,
          i
        );
      }
    } else if (isPrimitive(vnode.text)) {
      // 如果是一个基础类型，通过原生操作将当前节点插入到vnode.elm中
      nodeOps.appendChild(
        vnode.elm,
        nodeOps.createTextNode(String(vnode.text))
      );
    }
  }
  // 找到一个可以挂载的节点
  function isPatchable(vnode) {
    // 存在vnode.componentInstance为组件vnode
    // 这里需要找到一个不是组件vnode的节点
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode;
    }
    // 判断这个节点的tag是否存在
    return isDef(vnode.tag);
  }

  function invokeCreateHooks(vnode, insertedVnodeQueue) {
    // 获取到入口函数添加的cbs中各个函数
    /**
     * eg:
     * cbs = {
     *  activate: [ƒ]
        create: (8) [
          0: updateAttrs(oldVnode, vnode)
          1: updateClass(oldVnode, vnode)
          2: updateDOMListeners(oldVnode, vnode)
          3: updateDOMProps(oldVnode, vnode)
          4: updateStyle(oldVnode, vnode)
          5: _enter(_, vnode)
          6: create(_, vnode)
          7: updateDirectives(oldVnode, vnode)
        ]
        destroy: (2) [ƒ, ƒ]
        remove: [ƒ]
        update:: (7) [ƒ, ƒ, ƒ, ƒ, ƒ, ƒ, ƒ]
     * }
     */
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode);
    }
    i = vnode.data.hook; // Reuse variable
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode);
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode);
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope(vnode) {
    let i;
    if (isDef((i = vnode.fnScopeId))) {
      nodeOps.setStyleScope(vnode.elm, i);
    } else {
      let ancestor = vnode;
      while (ancestor) {
        if (isDef((i = ancestor.context)) && isDef((i = i.$options._scopeId))) {
          nodeOps.setStyleScope(vnode.elm, i);
        }
        ancestor = ancestor.parent;
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (
      isDef((i = activeInstance)) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef((i = i.$options._scopeId))
    ) {
      nodeOps.setStyleScope(vnode.elm, i);
    }
  }

  function addVnodes(
    parentElm,
    refElm,
    vnodes,
    startIdx,
    endIdx,
    insertedVnodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(
        vnodes[startIdx],
        insertedVnodeQueue,
        parentElm,
        refElm,
        false,
        vnodes,
        startIdx
      );
    }
  }

  function invokeDestroyHook(vnode) {
    let i, j;
    const data = vnode.data;
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode);
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
    }
    if (isDef((i = vnode.children))) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j]);
      }
    }
  }

  function removeVnodes(vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          removeAndInvokeRemoveHook(ch);
          invokeDestroyHook(ch);
        } else {
          // Text node
          removeNode(ch.elm);
        }
      }
    }
  }

  function removeAndInvokeRemoveHook(vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i;
      const listeners = cbs.remove.length + 1;
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners;
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners);
      }
      // recursively invoke hooks on child component root node
      if (
        isDef((i = vnode.componentInstance)) &&
        isDef((i = i._vnode)) &&
        isDef(i.data)
      ) {
        removeAndInvokeRemoveHook(i, rm);
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm);
      }
      if (isDef((i = vnode.data.hook)) && isDef((i = i.remove))) {
        i(vnode, rm);
      } else {
        rm();
      }
    } else {
      removeNode(vnode.elm);
    }
  }
  // 对比子节点,第一个参数是父节点，第二个是旧节点vnode数组，第三个是新节点数组
  function updateChildren(
    parentElm,
    oldCh,
    newCh,
    insertedVnodeQueue,
    removeOnly
  ) {
    /**
     * oldStartIndex                                                                     oldEndIndex
     *       A                        B                      C                                D
     *
     *
     *       D                        C                      B                                A                         E
     * newStartIndex                                                                                                newEndIndex
     */
    /***
     * 新节点的头和旧节点的头对比
     * 新节点的尾和旧节点的尾对比
     * 新节点的头和旧节点的尾
     * 旧节点的头和新节点的尾
     */
    // 旧节点开头位置
    let oldStartIdx = 0;
    // 新节点开头位置
    let newStartIdx = 0;
    // 老节点结束位置
    let oldEndIdx = oldCh.length - 1;
    // 新节点结束位置
    let newEndIdx = newCh.length - 1;
    //  旧节点开头的VNode
    let oldStartVnode = oldCh[0];
    // 旧节点结束的VNode
    let oldEndVnode = oldCh[oldEndIdx];
    // 新节点开始的VNode
    let newStartVnode = newCh[0];
    // 新节点结束的VNode
    let newEndVnode = newCh[newEndIdx];
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm;

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly;

    if (process.env.NODE_ENV !== "production") {
      checkDuplicateKeys(newCh);
    }
    // 老节点开始位置索引小于等于老节点结束位置索引（oldStartIdx <= oldEndIdx）
    // 新节点开始位置索引小于等于新节点结束位置索引（newStartIdx <= newEndIdx）
    // 只要不满足以上两种情况，就代表当前其中有已经把新的或者旧的节点遍历完了
    // 通过sameVnode方法对比是否相等可以复用
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) {
        // 如果oldStartVnode为null或者undefined执行这里
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        // 如果oldEndVnode为null或者undefined执行这里
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // 新老节点头一样
        patchVnode(newStartVnode, insertedVnodeQueue, newCh, newStartIdx);
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        // 新老节点尾一样
        patchVnode(
          oldEndVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // Vnode moved right
        // 老的头和新的尾部一样，将老的尾部插入到新的最后
        patchVnode(
          oldStartVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        );
        canMove &&
          nodeOps.insertBefore(
            parentElm,
            oldStartVnode.elm,
            nodeOps.nextSibling(oldEndVnode.elm)
          );
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        // Vnode moved left
        // 老的尾和新的头部一样，将老的尾移动到新的头部
        patchVnode(
          oldEndVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        );
        canMove &&
          nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        // 以上几种情况都不是的话
        if (isUndef(oldKeyToIdx))
          // 根据老节点上的key值创建一个对象
          /**
         *oldKeyToIdx = {
          //  key是节点上的key，后面的value是节点索引
           1:0,,
           2:1
          }
         */
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        // 是否定义了新开始节点的key，有的话去oldKeyToIdx这个对象中寻找
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx);
        // 没有从当前的oldKeyToIdx这个对象中找到，vue认为是一个新元素，创建新元素
        if (isUndef(idxInOld)) {
          // New element
          createElm(
            newStartVnode,
            insertedVnodeQueue,
            parentElm,
            oldStartVnode.elm,
            false,
            newCh,
            newStartIdx
          );
        } else {
          vnodeToMove = oldCh[idxInOld];
          if (sameVnode(vnodeToMove, newStartVnode)) {
            patchVnode(
              vnodeToMove,
              newStartVnode,
              insertedVnodeQueue,
              newCh,
              newStartIdx
            );
            oldCh[idxInOld] = undefined;
            canMove &&
              nodeOps.insertBefore(
                parentElm,
                vnodeToMove.elm,
                oldStartVnode.elm
              );
          } else {
            // same key but different element. treat as new element
            createElm(
              newStartVnode,
              insertedVnodeQueue,
              parentElm,
              oldStartVnode.elm,
              false,
              newCh,
              newStartIdx
            );
          }
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }
    if (oldStartIdx > oldEndIdx) {
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm;
      addVnodes(
        parentElm,
        refElm,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      );
    } else if (newStartIdx > newEndIdx) {
      removeVnodes(oldCh, oldStartIdx, oldEndIdx);
    }
  }

  function checkDuplicateKeys(children) {
    const seenKeys = {};
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i];
      const key = vnode.key;
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          );
        } else {
          seenKeys[key] = true;
        }
      }
    }
  }

  function findIdxInOld(node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i];
      if (isDef(c) && sameVnode(node, c)) return i;
    }
  }
  // 相同节点比对
  function patchVnode(
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    // 比较并更新当前元素的差异
    // 递归比较children
    if (oldVnode === vnode) {
      return;
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode);
    }
    // 获取当前oldVnode赋值给新的。
    // 能走到这个逻辑，证明新老节点是一个sameVnode，tag相同，新的vnode没有elm真实节点，所以直接赋值
    const elm = (vnode.elm = oldVnode.elm);

    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue);
      } else {
        vnode.isAsyncPlaceholder = true;
      }
      return;
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    if (
      isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance;
      return;
    }

    let i;
    const data = vnode.data;
    // 这里如果满足这些逻辑，证明是一个组件vnode，普通节点更新不会执行prepatch
    /**
     * 之前在render过程中，已经为每一个组件vnode挂载了hook
     * data = {
     * hook:init(),
     * destroy:destroy(),
     * prepatch:prepatch(),
     * insert:insert()
     * }
     */
    // 满足一下条件是一个组件vnode
    if (isDef(data) && isDef((i = data.hook)) && isDef((i = i.prepatch))) {
      // 这里会执行prepatch方法，定义在create-component中
      i(oldVnode, vnode);
    }
    /**
     * 这里的oldVnode, vnode是一整个大的包含最外侧app的vnode，里面的children是变化了的dom
     */
    const oldCh = oldVnode.children;
    const ch = vnode.children;
    if (isDef(data) && isPatchable(vnode)) {
      // 更新节点attr,比如指令等等，v-show也是这里的入口
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
      if (isDef((i = data.hook)) && isDef((i = i.update))) i(oldVnode, vnode);
    }
    // 比对children
    // 判断是不是有text，有text可能是最里面的一个节点
    /**
     * oldVnode
     * {
     * 最外侧大的节点
     *  elm:app,
     * tag:div
     * children:[{
     * 每一个节点
     *  tag:div,
     *  children:[{
     *    tag:undefined,
     *     text:1
     *  }]
     * }]
     * }
     *
     *
     *
     */
    if (isUndef(vnode.text)) {
      // 子节点就是每一个节点vnode（比如li）
      if (isDef(oldCh) && isDef(ch)) {
        // 1.新老节点如果都定义了children
        // 而且children不相同情况下，执行updateChildren
        if (oldCh !== ch)
          // 新旧节点都定义了children，而且children不相同情况下
          // 参数elm-根节点，oldCh-老的子节点数组，ch-新的子节点数组
          updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly);
      } else if (isDef(ch)) {
        // 2. 新的vnode有children，老的没有

        if (process.env.NODE_ENV !== "production") {
          checkDuplicateKeys(ch);
        }
        //
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, "");
        // 进行插入
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
      } else if (isDef(oldCh)) {
        // 3.老的vnode有children，新的没有
        // 执行删除老的节点
        removeVnodes(oldCh, 0, oldCh.length - 1);
      } else if (isDef(oldVnode.text)) {
        // 4.都没有children，老的有text，新的没有，那就设置为空
        nodeOps.setTextContent(elm, "");
      }
    } else if (oldVnode.text !== vnode.text) {
      // text不相同，直接设置text，文本节点替换
      nodeOps.setTextContent(elm, vnode.text);
    }
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.postpatch)))
        i(oldVnode, vnode);
    }
  }

  function invokeInsertHook(vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      vnode.parent.data.pendingInsert = queue;
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i]);
      }
    }
  }

  let hydrationBailed = false;
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap("attrs,class,staticClass,staticStyle,key");

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate(elm, vnode, insertedVnodeQueue, inVPre) {
    let i;
    const { tag, data, children } = vnode;
    inVPre = inVPre || (data && data.pre);
    vnode.elm = elm;

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true;
      return true;
    }
    // assert node match
    if (process.env.NODE_ENV !== "production") {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false;
      }
    }
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.init)))
        i(vnode, true /* hydrating */);
      if (isDef((i = vnode.componentInstance))) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue);
        return true;
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue);
        } else {
          // v-html and domProps: innerHTML
          if (
            isDef((i = data)) &&
            isDef((i = i.domProps)) &&
            isDef((i = i.innerHTML))
          ) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn("server innerHTML: ", i);
                console.warn("client innerHTML: ", elm.innerHTML);
              }
              return false;
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true;
            let childNode = elm.firstChild;
            for (let i = 0; i < children.length; i++) {
              if (
                !childNode ||
                !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)
              ) {
                childrenMatch = false;
                break;
              }
              childNode = childNode.nextSibling;
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (
                process.env.NODE_ENV !== "production" &&
                typeof console !== "undefined" &&
                !hydrationBailed
              ) {
                hydrationBailed = true;
                console.warn("Parent: ", elm);
                console.warn(
                  "Mismatching childNodes vs. VNodes: ",
                  elm.childNodes,
                  children
                );
              }
              return false;
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false;
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true;
            invokeCreateHooks(vnode, insertedVnodeQueue);
            break;
          }
        }
        if (!fullInvoke && data["class"]) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data["class"]);
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text;
    }
    return true;
  }

  function assertNodeMatch(node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return (
        vnode.tag.indexOf("vue-component") === 0 ||
        (!isUnknownElement(vnode, inVPre) &&
          vnode.tag.toLowerCase() ===
            (node.tagName && node.tagName.toLowerCase()))
      );
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3);
    }
  }
  // 最后返回patch函数 __PATCH__最终会调用这里的函数
  //
  // 函数把接受多个参数的函数变换成接受一个单一参数（最初函数的第一个参数）的函数，并且返回接受余下的参数而且返回结果的新函数的技术。

  // 如果是更新dom,oldVnode以及vnode都会有值
  // 这里是调用_update方法真正的入口
  /**
   * export function isUndef (v: any): boolean % checks {
      return v === undefined || v === null
    }

    export function isDef (v: any): boolean % checks {
      return v !== undefined && v !== null
    }
   */
  /**
   * 这里的oldVnode，vnode是一整个大的包含#app的vnode，里面还有children才是每一个
   * 数据变化，把变化过后的数据转换为vnode，和旧的vnode对比
   * 数据变化是如何转换为vnode？
   * 重新生成render函数执行，如果是v-for，就执行renderlist方法遍历新的数据，每次再执行一下_c创建节点返回vnode，最后给到update去patch
   */
  return function patch(oldVnode, vnode, hydrating, removeOnly) {
    // 判断是不是等于null或者undefined
    // 删除时候的逻辑
    //
    if (isUndef(vnode)) {
      // 判断不为null或者undefined
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode);
      return;
    }

    let isInitialPatch = false;
    const insertedVnodeQueue = [];
    // 第一次oldVnode就是真实的节点，是存在的
    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element
      isInitialPatch = true;
      createElm(vnode, insertedVnodeQueue);
    } else {
      // 是不是真实的dom，第一次首次渲染为true，之后的oldVnode和vnode都是VNode类型，会返回false
      const isRealElement = isDef(oldVnode.nodeType);
      // 此处的if条件为判断新旧节点是否相同

      // sameVnode 判断两个vnode是不是相同的vnode
      // !isRealElement不是真实的节点，这里的两个vnode相同情况下执行的逻辑，首次渲染不会执行这里
      // 对比最外侧的节点是不是sameVnode，最外侧都不是的情况下，直接走下面的创建删除过程，否则对比其子节点
      /**
       * 这里的oldVnode, vnode是一整个大的包含最外侧app的vnode
       */
      // 这里的流程是根据两个vnode是不是相同来执行不同操作
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // patch existing root node
        // 相同patchVnode
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly);
      } else {
        // 两个vnode(新旧节点)不相同的情况
        /**
         * 1.创建新节点
         * 2.更新父占位符节点
         * 3.删除旧节点
         *
         */
        if (isRealElement) {
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          // 这个if是服务端渲染的逻辑
          // oldVnode.nodeType === 1 元素节点
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR);
            hydrating = true;
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true);
              return oldVnode;
            } else if (process.env.NODE_ENV !== "production") {
              warn(
                "The client-side rendered virtual DOM tree is not matching " +
                  "server-rendered content. This is likely caused by incorrect " +
                  "HTML markup, for example nesting block-level elements inside " +
                  "<p>, or missing <tbody>. Bailing hydration and performing " +
                  "full client-side render."
              );
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          // 把真实的dom转换为vnode
          // 第一次渲染时候，会把传入的真实节点转换为VNode，这一次的VNode会变成oldVnode
          oldVnode = emptyNodeAt(oldVnode);
        }

        // 第一步：创建新节点， 把vnode挂载到真实的dom上
        // replacing existing element
        // e.g #app <body></body>
        // 旧的dom节点，VNode中的elm是其对应的真实dom节点
        const oldElm = oldVnode.elm;
        // 获取父节点，nodeOps是一系列真实的dom操作，假如当前oldElm是app，其父节点就是body
        const parentElm = nodeOps.parentNode(oldElm);

        // create new node
        // 传入vnode和parentElm就知道当前应该挂载在哪一个组件上
        // 这个方法的作用是将VNode挂载到真实的dom上，通过createChild方法，递归调用createElm深度优先创建子节点，构建完整dom树
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        );

        // update parent placeholder node element, recursively
        // 第二步：递归更新父占位符节点，组件相关
        /**
         *  之前在\src\core\instance\render.js中的__render()函数执行完成之后,会执行vnode.parent = _parentVnode;
         *  这里的_parentVnode来自在InternalComponentOptions这里中的
         *   export function createComponentInstanceForVnode(
             const options: InternalComponentOptions = {
                // 标识位
                _isComponent: true,
                _parentVnode: vnode,
                parent
              }
              )
         */

        if (isDef(vnode.parent)) {
          // 获取到当前vnode的祖先
          /**
           * ancestor(祖先)
           */
          let ancestor = vnode.parent;
          // 找到当前可挂载的真实dom节点
          // 渲染vnode-根vnode
          const patchable = isPatchable(vnode);
          // 递归更新父占位符节点，父占位符节点就是组件，比如
          /**
           * <hello-world></hello-world>
           * 这个会被渲染为组件vnode
           */
          while (ancestor) {
            // 1.执行对应的钩子函数
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor);
            }
            /**
             * 这里的vnode.elm是上面createElm生成的真实节点，赋值给了父占位符vnode.parent.elm
             */
            // 2.更新引用
            ancestor.elm = vnode.elm;
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor);
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert;
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]();
                }
              }
            } else {
              registerRef(ancestor);
            }
            ancestor = ancestor.parent;
          }
        }

        // destroy old node
        // 第三步：删除旧的节点，原来的旧节点和新创建的节点一共有两个
        /**
         * <div id="app">{{a}}</div>这个节点是旧的节点会被删除
         * <div id="app">1</div>这个节点是替换之后的，会同时存在两个节点，上面的那个会被删除掉
         */
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0);
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode);
        }
      }
    }

    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch);
    return vnode.elm;
  };
}
