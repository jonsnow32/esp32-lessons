/* ALU, loops, shifts, division, conditional moves, S32C1I. Results in result[0..]. */
    .text
    .align 4
    .global main
main:
    entry   a1, 32
    movi    a8, result
    /* sum 1..100 with a zero-overhead loop */
    movi    a2, 0
    movi    a3, 1
    movi    a4, 100
    loop    a4, 1f
    add     a2, a2, a3
    addi    a3, a3, 1
1:  s32i    a2, a8, 0           /* 5050 */
    /* 10! with mull */
    movi    a2, 1
    movi    a3, 10
2:  mull    a2, a2, a3
    addi    a3, a3, -1
    bnez    a3, 2b
    s32i    a2, a8, 4           /* 3628800 */
    /* signed division and remainder */
    movi    a3, -100
    movi    a4, 7
    quos    a5, a3, a4
    rems    a6, a3, a4
    slli    a5, a5, 8
    extui   a6, a6, 0, 8
    or      a5, a5, a6
    s32i    a5, a8, 8           /* (-14 << 8) | (-2 & 0xff) */
    /* 64-bit funnel shift: (0x12345678_9abcdef0 >> 12) low word */
    movi    a3, 0x12345678
    movi    a4, 0x9abcdef0
    ssai    12
    src     a5, a3, a4
    s32i    a5, a8, 12          /* 0x6789abcd */
    /* nsau / nsa / min / clamps / sext */
    movi    a3, 0x00f00000
    nsau    a4, a3              /* 8 */
    movi    a3, -5
    nsa     a5, a3              /* 28 */
    slli    a4, a4, 8
    or      a4, a4, a5
    s32i    a4, a8, 16          /* 0x81c */
    movi    a3, 1000
    clamps  a4, a3, 7           /* 127: clamped to [-128, 127] */
    movi    a3, 0x80
    sext    a5, a3, 7           /* -128 */
    add     a4, a4, a5
    s32i    a4, a8, 20          /* 127 + -128 = -1 */
    /* s32c1i: succeeds when memory == SCOMPARE1, fails otherwise */
    movi    a3, 41
    s32i    a3, a8, 24
    wsr.scompare1 a3
    movi    a4, 42
    s32c1i  a4, a8, 24          /* a4 = 41 (old), mem = 42 */
    movi    a5, 99
    s32c1i  a5, a8, 24          /* mem is 42 ≠ 41: a5 = 42, mem unchanged */
    add     a4, a4, a5
    l32i    a5, a8, 24
    add     a4, a4, a5
    s32i    a4, a8, 28          /* 41 + 42 + 42 = 125 */
    retw
