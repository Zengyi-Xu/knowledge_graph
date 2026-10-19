# LaTeX 专业渲染回归

## 截图中的真实公式

发射 chirp：能量 $E$，时长 $T$，峰值功率 $P_{\mathrm{tx}}=E/T$。
匹配滤波后压缩到 $\tau_c=1/B_{\mathrm{eff}}$：

$$
P_c=\frac{E}{\tau_c}=P_{\mathrm{tx}}\,\left(T\,B_{\mathrm{eff}}\right)
\quad\Rightarrow\quad
G=10\log_{10}\left(\mathrm{TBP}_{\mathrm{eff}}\right)\ \mathrm{dB}
$$

**关键：把 TBP 的定义带宽固定为接收机带宽 $B_{\mathrm{det}}$，而不是光学带宽。**
压缩脉冲的本征宽度是 $1/\Delta f_{\mathrm{optical}}$（30 nm 时 $\approx 0.27$ ps），任何探测器都分辨不了。

$$
\mathrm{TBP}_{\mathrm{eff}}=T\,B_{\mathrm{det}}
$$

（不是 $T\,\Delta f_{\mathrm{optical}}$）。

## 矩阵、分段与多行对齐

\[
\mathbf{H}=\begin{bmatrix}
h_{11} & h_{12} \\
h_{21} & h_{22}
\end{bmatrix},\qquad
\det(\mathbf{H})=h_{11}h_{22}-h_{12}h_{21}
\]

\begin{align}
S(f) &= \int_{-\infty}^{\infty}s(t)e^{-j2\pi ft}\,\mathrm{d}t \\
P_e &= \sum_{k=0}^{N-1}\left|x_k-\hat{x}_k\right|^2
\end{align}

$$
f(x)=\begin{cases}
x^2, & x\ge 0 \\
-x, & x<0
\end{cases}
$$

行内圆括号格式：\(\sigma^2=\mathbb{E}[(X-\mu)^2]\)。

## 不应误判

价格 $20 不应被当成公式；`$x_1$` 在行内代码中保持源码。

```tex
\frac{这里是代码}{不能渲染}
```

