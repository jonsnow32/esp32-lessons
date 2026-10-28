/* FPU: (3 * 2.5 + 0.25) * 4 → 31, then the same with the coprocessor disabled must trap. */
    .text
    .align 4
    .global main
main:
    entry   a1, 32
    movi    a2, 1
    wsr.cpenable a2
    rsync
    movi    a2, 3
    float.s f0, a2, 0
    movi    a2, 5
    float.s f1, a2, 1           /* 2.5 */
    movi    a2, 1
    float.s f2, a2, 2           /* 0.25 */
    madd.s  f2, f0, f1          /* 7.75 */
    trunc.s a3, f2, 2           /* 31 */
    movi    a2, result
    s32i    a3, a2, 0
    olt.s   b0, f0, f1          /* 3 < 2.5 false */
    movi    a4, 1
    movi    a5, 0
    movt    a4, a5, b0          /* stays 1 */
    s32i    a4, a2, 4
    movi    a3, 0
    wsr.cpenable a3
    rsync
    add.s   f0, f0, f0          /* Coprocessor0Disabled → kernel vector → break 1, 2 */
    retw
