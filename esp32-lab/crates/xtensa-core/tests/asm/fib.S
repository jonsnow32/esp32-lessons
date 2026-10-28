/* Recursive Fibonacci with CALL8 – deep enough to exhaust the 16 register windows many times,
   so window overflow/underflow handlers run constantly. Result in `result`. */
    .text
    .align 4
    .global main
main:
    /* 48 bytes: a function that uses CALL12 needs room for its callees' 12-register spills */
    entry   a1, 48
    movi    a10, 20
    call8   fib
    movi    a2, result
    s32i    a10, a2, 0
    /* CALL12 path too */
    movi    a14, 12
    call12  fib12
    s32i    a14, a2, 4
    retw

fib:                        /* a2 = n → a2 = fib(n) */
    entry   a1, 32
    bgei    a2, 2, 1f
    retw
1:  addi    a10, a2, -1
    call8   fib
    mov     a3, a10
    addi    a10, a2, -2
    call8   fib
    add     a2, a3, a10
    retw

    .align 4
fib12:
    entry   a1, 48
    bgei    a2, 2, 1f
    retw
1:  addi    a14, a2, -1
    call12  fib12
    mov     a3, a14
    addi    a14, a2, -2
    call12  fib12
    add     a2, a3, a14
    retw
