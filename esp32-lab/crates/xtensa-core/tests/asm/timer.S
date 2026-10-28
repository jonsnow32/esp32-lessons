/* CCOMPARE0 level-1 interrupt woken from WAITI three times. */
    .text
    .align 4
    .global main
main:
    entry   a1, 32
    rsr.ccount a2
    addmi   a2, a2, 0x1000
    wsr.ccompare0 a2
    movi    a2, 1 << 6
    wsr.intenable a2
    movi    a3, ticks
1:  waiti   0
    l32i    a4, a3, 0
    blti    a4, 3, 1b
    movi    a2, 0
    wsr.intenable a2
    movi    a2, result
    s32i    a4, a2, 0
    retw
