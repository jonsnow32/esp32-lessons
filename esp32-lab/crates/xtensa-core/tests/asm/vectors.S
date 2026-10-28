/* Minimal vector table for bare-metal tests: the standard Xtensa window spill/fill handlers
   (same code as ESP-IDF's xtensa_vectors.S), a level-1 interrupt handler and a trap for
   anything unexpected. Linked at VECBASE = 0x40080000. */
    .section .text
    .global _vectors
_vectors:
    .org 0x000
_WindowOverflow4:
    s32e    a0, a5, -16
    s32e    a1, a5, -12
    s32e    a2, a5, -8
    s32e    a3, a5, -4
    rfwo
    .org 0x040
_WindowUnderflow4:
    l32e    a0, a5, -16
    l32e    a1, a5, -12
    l32e    a2, a5, -8
    l32e    a3, a5, -4
    rfwu
    .org 0x080
_WindowOverflow8:
    s32e    a0, a9, -16
    l32e    a0, a1, -12
    s32e    a2, a9, -8
    s32e    a1, a9, -12
    s32e    a3, a9, -4
    s32e    a4, a0, -32
    s32e    a5, a0, -28
    s32e    a6, a0, -24
    s32e    a7, a0, -20
    rfwo
    .org 0x0c0
_WindowUnderflow8:
    l32e    a1, a9, -12
    l32e    a0, a9, -16
    l32e    a7, a1, -12
    l32e    a2, a9, -8
    l32e    a4, a7, -32
    l32e    a3, a9, -4
    l32e    a5, a7, -28
    l32e    a6, a7, -24
    l32e    a7, a7, -20
    rfwu
    .org 0x100
_WindowOverflow12:
    s32e    a0,  a13, -16
    l32e    a0,  a1,  -12
    s32e    a1,  a13, -12
    s32e    a2,  a13, -8
    s32e    a3,  a13, -4
    s32e    a4,  a0,  -48
    s32e    a5,  a0,  -44
    s32e    a6,  a0,  -40
    s32e    a7,  a0,  -36
    s32e    a8,  a0,  -32
    s32e    a9,  a0,  -28
    s32e    a10, a0,  -24
    s32e    a11, a0,  -20
    rfwo
    .org 0x140
_WindowUnderflow12:
    l32e    a1,  a13, -12
    l32e    a0,  a13, -16
    l32e    a11, a1,  -12
    l32e    a2,  a13, -8
    l32e    a4,  a11, -48
    l32e    a8,  a11, -32
    l32e    a3,  a13, -4
    l32e    a5,  a11, -44
    l32e    a6,  a11, -40
    l32e    a7,  a11, -36
    l32e    a9,  a11, -28
    l32e    a10, a11, -24
    l32e    a11, a11, -20
    rfwu
    .org 0x300
_KernelExceptionVector:
    j       _kernel_handler
    .org 0x340
_UserExceptionVector:
    j       _kernel_handler
    .org 0x3c0
_DoubleExceptionVector:
    break   1, 1
    .org 0x400
    .literal_position

/* Level-1 interrupts: count CCOMPARE0 ticks in `ticks`, re-arm and return.
   Any other exception stops the test with break 1, 2. */
    .align 4
_kernel_handler:
    wsr.excsave1 a2
    rsr.exccause a2
    beqi    a2, 4, 1f
    break   1, 2
1:  movi    a2, ticks
    s32i    a3, a2, 4
    l32i    a3, a2, 0
    addi    a3, a3, 1
    s32i    a3, a2, 0
    rsr.ccompare0 a3
    addmi   a3, a3, 0x1000
    wsr.ccompare0 a3
    l32i    a3, a2, 4
    rsr.excsave1 a2
    rfe

    .align 4
    .global _start
_start:
    movi    a0, 0
    movi    a1, _stack_top
    movi    a2, _vectors
    wsr.vecbase a2
    movi    a2, 1
    wsr.windowstart a2
    movi    a2, 0
    wsr.windowbase a2
    rsync
    movi    a2, 0x40000          /* PS.WOE = 1, INTLEVEL 0, EXCM 0 */
    wsr.ps  a2
    rsync
    call4   main
    break   1, 15

    .data
    .align 4
    .global ticks
ticks:  .word 0, 0
    .global result
result: .word 0, 0, 0, 0, 0, 0, 0, 0
