/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
// 用来捕获标签上的属性
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// 字母下划线开头，后面是单词或者-.
// namespace命名空间 ?代表是0个或者1个
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
// 捕获分组是(),(?:)的意思是不捕获
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 以<开头
const startTagOpen = new RegExp(`^<${qnameCapture}`)
// 匹配结束标签以任意单词开头重复不管多少次，后面的/可以有可以没有用来匹配自闭和标签<img/>
const startTagClose = /^\s*(\/?)>/
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
// 注释节点
const comment = /^<!\--/
// 条件注释
// <![if IE 6]>
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}
// 解析html，基于simple-html-parser做的，标签相当于一个栈数据结构
// html就是包含#app的html
export function parseHTML (html, options) {
  // 保留匹配到的标签和属性
  /**
   * [{
      end: 14
      lowerCasedTag: "div"
      start: 0
      tag: "div",
      attrs:[{name:"id",value:"app",start:0,end:13}]
    }]
   */
  const stack = []
  // 这里初始化为true
  const expectHTML = options.expectHTML
  const isUnaryTag = options.isUnaryTag || no
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 当前html位置索引
  let index = 0
  // 保留上一次的文本和上一次标签
  let last, lastTag
  // 循环html
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    //            判断lastTag是不是script,style,textarea
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 不断的截取以<开头的字符串
      let textEnd = html.indexOf('<')
      // 如果是<并且为0，就是在第一个位置,有可能是开头,也有可能是中间部分的标签,因为会通过advance方法前进
      if (textEnd === 0) {
        // Comment:
        // 判断是不是注释节点，comment上面定义了正则
        // 匹配开头是不是<!--
        if (comment.test(html)) {
          // 找到结束位置
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            // 是不是要保留注释节点
            if (options.shouldKeepComment) {
              // 这里的方法commen方法就是在parseHTML（template,options）传入的,start,end,chars,comment等方法
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            advance(commentEnd + 3)
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 如果是条件注释
        // <![if IE 6]>
        if (conditionalComment.test(html)) {
          // 找到结尾注释
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            // 截取，前进到后面，continue本次循环，什么也不做
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // 是不是一个doctype，如果是，直接截取，然后跳过
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        // 结束标签的匹配
        // </div>或者</comp-a>这种
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          // 前进匹配到的标签length位数
          advance(endTagMatch[0].length)
          // endTagMatch为comp-a        49        66
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // 开始标签的匹配，如果匹配到，会返回一个match对象
        /**ex:
          const match = {
            attrs: ["id=app","id","=","app"]
            end: 14
            start: 0
            tagName: "div"
            unarySlash: ""
        */
        //  <div id="app">
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          // 将匹配到的attrs数组格式化为[{name:"id",value:"app",start:0,end:13}]
          // 并且调用options.start生成ast
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }
      // 如果textEnd不是0，，说明需要处理剩下的html
      let text, rest, next

      if (textEnd >= 0) {
        // 从当前的html截取到下一个<开头的地方作为rest
        /**
         * {{a}} <comp-a></comp-a>
         * 这里的rest就是<comp-a></comp-a>，至于{{a}}在下面会额外截取出来
         */
        rest = html.slice(textEnd)
        // while判断是不是在textEnd中有<文本符号
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1)
          if (next < 0) break
          textEnd += next
          rest = html.slice(textEnd)
        }
        // 把文本截取出来
        /**
         * html:{{a}} <comp-a></comp-a>
         * 截取之后: {{a}}
         */
        text = html.substring(0, textEnd)
      }
      //
      if (textEnd < 0) {
        text = html
      }
      // 前进到下一个位置
      if (text) {
        advance(text.length)
      }
      // 文本节点
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }
    // 判断这两个剩余的template是否相等
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()
/**
 * 修改index的位置
 * 比如
 * <div>132</div>
 * 通过advance索引+5处理的话就是
 * 132</div>
 */
  function advance (n) {
    index += n
    html = html.substring(n)
  }
  // 匹配开始标签，返回一个match对象
  function parseStartTag () {
    // 如果是刚开始时候
    // start为["<div", "div", index: 0, input:xxx]
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        // 标签名称 div
        tagName: start[1],
        // 保留属性
        /**
         * ["id=app","id","=","app"]
         */
        attrs: [],
        start: index
      }
      // 匹配到标签然后前进，第一次为start[0]为<div，通过advance方法，截取掉<div,将剩下的作为新的html
      advance(start[0].length)
      let end, attr
      //或者匹配到>标签     匹配attr属性，比如:class="xxx" class="xxx" v-if="xxx"
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        // 每次匹配到就前进attr[0].length位
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      // 匹配到结束标签
      // unarySlash翻译意思为一元斜杠
      if (end) {
        match.unarySlash = end[1]
        // 前进end[0].length位
        advance(end[0].length)
        // 将index赋值给end
        match.end = index
        return match
      }
    }
  }
  // 作用是将标签上的属性解析出来
  // 刚解析出来的标签上的属性为["id="app"", "id", "=", "app", undefined, undefined]
  // 通过这个方法格式化为{name:"id",value:"app",start:0,end:13}，并且调用options.start生成ast
  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash
    // web平台初始化为true
    // html5中的7大类和内容模型处理，有些元素不可以放在p标签中，这里做判断，放在p标签中，也会被单独提取出来，不会嵌套
    if (expectHTML) {
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }
    // 这里的匹配哪些标签可以是自闭和标签,平台操作相关
    /**
     * isUnaryTag = makeMap('area,base,br,col,embed,hr,frame,input,link,img....')
     */
    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs = new Array(l)
    // 遍历匹配到的某一段标签的attr
    // ["id="app"", "id", "=", "app", undefined, undefined]
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      // 捕获的分组
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }
    // 自闭和标签
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }
    // 生成ast
    if (options.start) {
      // ex：div [{name:id,value:app,start:0,end:10}]   false  0  14
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }
  //解析结束时候的标签</com-a>或者</div> 这里的参数假设为: comp-a    49    66
  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 通过在stack中保存的标签，这里会用来匹配是不是一一对应
    if (tagName) {
      // 传入的标签名
      lowerCasedTagName = tagName.toLowerCase()
      // 倒序判断当前的标签，因为解析到开始标签会加入到stack，是按照栈数据结构添加的，匹配到第一个结束标签，一定是和stack最后一个一一对应
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    if (pos >= 0) {
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          // 如果标签没有写对，比如只有开始标签没有结束标签会出现这个错误
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        // 匹配到结束标签，调用end
        if (options.end) {
          // 假设参数为，comp-a     59     66
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      // 从stack中删除元素
      stack.length = pos
      // 更新lasttag
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      // 对边界情况做处理，闭合标签
      if (options.start) {
        // 这里的true表示为自闭和标签
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      // 对边界情况做处理，闭合标签，html5的7大类内容模型情况处理，p标签包含了不能包含的标签，手动闭合
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
