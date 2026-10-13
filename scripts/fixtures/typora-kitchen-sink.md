---
title: Markdown 全语法检查
author: QA
date: 2026-10-11
---

# H1 一级标题

## H2 二级标题

### H3 三级标题

#### H4 四级标题

##### H5 五级标题

###### H6 六级标题

Setext 一级标题
==============

Setext 二级标题
--------------

## 行内语法

正文段落：*斜体*、_斜体_、**粗体**、__粗体__、***粗斜体***、~~删除线~~、==高亮==、`行内代码`、<kbd>Ctrl</kbd>+<kbd>C</kbd>。

上下标：H~2~O、x^2^、σ~w~，以及 <sub>sub</sub> 与 <sup>sup</sup>。

转义：\*不是斜体\*、\#不是标题、\| 是竖线、\\ 是反斜杠、\_不是斜体\_。

行内代码里的反引号：`` `code` `` 与 `**不是粗体**`。

实体：&amp; &lt; &gt; &copy; &#65; 结束。

硬换行（行尾两个空格）：  
这一行应紧接着上一行。

反斜杠硬换行：\
这一行也应紧跟上一行。

## 链接与图片

[行内链接](https://example.com "悬停标题")、[引用式链接][ref1]、<https://example.com/auto>、裸链接 https://example.org/x?y=1。

![图片](https://example.com/a.png "图片标题")

## 引用

> 引用第一段
>
> > 嵌套引用
>
> 引用中的列表：
>
> - 引用列表项
> - 第二项
>
> ```js
> // 引用中的代码块
> const a = 1
> ```

## 列表

无序（紧凑）：

- 项目 A
- 项目 B
  - 嵌套 B1
  - 嵌套 B2
    - 三层嵌套
- 项目 C

无序（宽松，含多段）：

- 第一段

  同一项的第二段

- 另一项

有序：

1. 第一步
2. 第二步
   1. 子步骤一
   2. 子步骤二
3. 第三步

有序（从 5 开始）：

5. 五
6. 六

其他标记：

* 星号项
+ 加号项

任务列表：

- [x] 已完成的任务
- [ ] 未完成的任务
  - [ ] 嵌套的未完成任务

列表项中的代码块：

- 项目一

  ```python
  print("hi")
  ```

- 项目二

## 定义列表

术语 A
: 定义 A 的内容

术语 B
: 定义 B 的第一行
: 定义 B 的第二行

## 表格

| 左对齐 | 居中 | 右对齐 | 默认 |
|:-------|:----:|-------:|------|
| 文本   | **粗** | 1.23 | `code` |
| WK1    | 是    | 4.56 | [链接](https://example.com) |
| 公式   | H~2~O | x^2^ | ~~删除~~ |

## 代码块

```python
def f(x):
    return x  # | 不是表格 | 不是标题
```

~~~text
波浪号围栏
~~~

缩进代码块：

    indented code
    second line

## 分隔线

---

***

___

## HTML 与数学

行内 HTML：<span data-x="1">span</span>、<mark>mark 标签</mark>、<em>em</em>、<strong>strong</strong>、<kbd>kbd</kbd>、<del>del</del>、<u>u</u>。

块级 HTML：

<div style="border:1px solid #ccc; padding:8px; border-radius:6px">
  <strong>div 里的粗体</strong> 与 <em>斜体</em>
</div>

<details>
  <summary>折叠块（details/summary）</summary>
  折叠内容，含 <a href="https://example.com">链接</a>。
</details>

行内数学 $E = mc^2$，块级数学：

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

## 脚注与目录

这里有脚注[^1]与命名脚注[^note]。

[TOC]

[^1]: 脚注 1 的内容。

[^note]: 命名脚注的内容，含 **粗体** 与 [链接](https://example.com)。

## 表情与标签

表情：:smile: :+1: :rocket: :warning: :tada:

双链：[[量子点激光模式控制 Optica 2026]]、[[不存在的笔记]]、[[Yating Wan|万老师]]

标签：#光学 #样品 #status/active

## 结语

最后一段。

[ref1]: https://example.com/ref "引用式链接标题"
