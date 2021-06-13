/* @flow */

import config from 'core/config'
import { addHandler, addProp, getBindingAttr } from 'compiler/helpers'
import { genComponentModel, genAssignmentCode } from 'compiler/directives/model'

let warn

// in some cases, the event used has to be determined at runtime
// so we used some reserved tokens during compile.
export const RANGE_TOKEN = '__r'
export const CHECKBOX_RADIO_TOKEN = '__c'
// 这里是处理v-model的逻辑
export default function model (
  // 当期的ast
  el: ASTElement,
  // 指令
  /**
   *  arg: null
      end: 58
      isDynamicArg: false
      modifiers: undefined
      name: "model"
      rawName: "v-model"
      start: 44
      // 绑定的data中的值
      value: "name"
   */
  dir: ASTDirective,
  _warn: Function
): ?boolean {
  warn = _warn
  // 获取到绑定的data中的值 eg: name(v-model="name")
  const value = dir.value
  // 获取指令修饰符 eg:v-model.number = xxx
  const modifiers = dir.modifiers
  // 获取到目标节点标签名 eg:input
  const tag = el.tag
  // 获取到当前节点上的type值 eg:text
  const type = el.attrsMap.type

  if (process.env.NODE_ENV !== 'production') {
    // inputs with type="file" are read only and setting the input's
    // value will throw an error.
    if (tag === 'input' && type === 'file') {
      warn(
        `<${el.tag} v-model="${value}" type="file">:\n` +
        `File inputs are read only. Use a v-on:change listener instead.`,
        el.rawAttrsMap['v-model']
      )
    }
  }
  // 处理el是组件情况
  if (el.component) {
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (tag === 'select') {
    // 处理el是select
    genSelect(el, value, modifiers)
  } else if (tag === 'input' && type === 'checkbox') {
    // 处理是多选框
    genCheckboxModel(el, value, modifiers)
  } else if (tag === 'input' && type === 'radio') {
    // 处理单选框
    genRadioModel(el, value, modifiers)
  } else if (tag === 'input' || tag === 'textarea') {
    // 处理文本域
    genDefaultModel(el, value, modifiers)
  } else if (!config.isReservedTag(tag)) {
    // 其余情况处理
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `<${el.tag} v-model="${value}">: ` +
      `v-model is not supported on this element type. ` +
      'If you are working with contenteditable, it\'s recommended to ' +
      'wrap a library dedicated for that purpose inside a custom component.',
      el.rawAttrsMap['v-model']
    )
  }

  // ensure runtime directive metadata
  return true
}

function genCheckboxModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  const valueBinding = getBindingAttr(el, 'value') || 'null'
  const trueValueBinding = getBindingAttr(el, 'true-value') || 'true'
  const falseValueBinding = getBindingAttr(el, 'false-value') || 'false'
  addProp(el, 'checked',
    `Array.isArray(${value})` +
    `?_i(${value},${valueBinding})>-1` + (
      trueValueBinding === 'true'
        ? `:(${value})`
        : `:_q(${value},${trueValueBinding})`
    )
  )
  addHandler(el, 'change',
    `var $$a=${value},` +
        '$$el=$event.target,' +
        `$$c=$$el.checked?(${trueValueBinding}):(${falseValueBinding});` +
    'if(Array.isArray($$a)){' +
      `var $$v=${number ? '_n(' + valueBinding + ')' : valueBinding},` +
          '$$i=_i($$a,$$v);' +
      `if($$el.checked){$$i<0&&(${genAssignmentCode(value, '$$a.concat([$$v])')})}` +
      `else{$$i>-1&&(${genAssignmentCode(value, '$$a.slice(0,$$i).concat($$a.slice($$i+1))')})}` +
    `}else{${genAssignmentCode(value, '$$c')}}`,
    null, true
  )
}

function genRadioModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  let valueBinding = getBindingAttr(el, 'value') || 'null'
  valueBinding = number ? `_n(${valueBinding})` : valueBinding
  addProp(el, 'checked', `_q(${value},${valueBinding})`)
  addHandler(el, 'change', genAssignmentCode(value, valueBinding), null, true)
}

function genSelect (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  const selectedVal = `Array.prototype.filter` +
    `.call($event.target.options,function(o){return o.selected})` +
    `.map(function(o){var val = "_value" in o ? o._value : o.value;` +
    `return ${number ? '_n(val)' : 'val'}})`

  const assignment = '$event.target.multiple ? $$selectedVal : $$selectedVal[0]'
  let code = `var $$selectedVal = ${selectedVal};`
  code = `${code} ${genAssignmentCode(value, assignment)}`
  addHandler(el, 'change', code, null, true)
}
// 处理默认的v-model情况，比如<input v-model="name" type="text"/>
function genDefaultModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
): ?boolean {
  const type = el.attrsMap.type

  // warn if v-bind:value conflicts with v-model
  // except for inputs with v-bind:type
  if (process.env.NODE_ENV !== 'production') {
    const value = el.attrsMap['v-bind:value'] || el.attrsMap[':value']
    const typeBinding = el.attrsMap['v-bind:type'] || el.attrsMap[':type']
    if (value && !typeBinding) {
      const binding = el.attrsMap['v-bind:value'] ? 'v-bind:value' : ':value'
      warn(
        `${binding}="${value}" conflicts with v-model on the same element ` +
        'because the latter already expands to a value binding internally',
        el.rawAttrsMap[binding]
      )
    }
  }

  const { lazy, number, trim } = modifiers || {}
  const needCompositionGuard = !lazy && type !== 'range'
  const event = lazy
    ? 'change'
    : type === 'range'
      ? RANGE_TOKEN
      : 'input'

  let valueExpression = '$event.target.value'
  if (trim) {
    valueExpression = `$event.target.value.trim()`
  }
  if (number) {
    valueExpression = `_n(${valueExpression})`
  }
  // 生成一段赋值代码
  // eg: "name=$event.target.value"
  let code = genAssignmentCode(value, valueExpression)
  //
  if (needCompositionGuard) {
    code = `if($event.target.composing)return;${code}`
  }
  // 关键方法，添加prop为value的属性
  /**
   * 当前ast添加props属性
   * props:[
   *   {
   *    dynamic: undefined
        name: "value"
        value: "(name)"
      }]
   */
  // 相当于<input :value="name" @input="name=$event.target.value">
  addProp(el, 'value', `(${value})`)
  // eg:el=ast    event=input  code="if($event.target.composing)return;name=$event.target.value"
  // 给当前el添加事件，处理完的el中会包含一个events的属性,里面有一个input事件
  /**
   * {
   *  events:{
   *    input:{
   *      dynamic: undefined
   *      value: "if($event.target.composing)return;name=$event.target.value"}
   *   }
   * }
   *
   */
  addHandler(el, event, code, null, true)
  if (trim || number) {
    addHandler(el, 'blur', '$forceUpdate()')
  }
}
