/*
 * MSVC 64-bit integer helper routines (__alldiv / __aulldiv / __allrem /
 * __aullrem / __allmul) referenced by MSVC-C++-ABI objects (libxnet -- built
 * with a target that emits these for 64-bit / and % instead of compiler-rt's
 * __divdi3 etc.). This file compiles under the normal GNU ABI, so the C
 * operators below lower to compiler-rt (__divdi3, __udivdi3, __moddi3,
 * __umoddi3, __muldi3) -- i.e. these are thin name/ABI shims, not
 * reimplementations. Any project linking libxnet needs this file.
 *
 * ABI: MSVC's helpers take their two 8-byte operands on the stack and clean
 * them (ret 0x10) -> __attribute__((stdcall)). The exact COFF symbol name
 * (no leading underscore, no @N decoration) is set via an asm() label, which
 * clang uses verbatim; stdcall still governs the ret-16 codegen.
 */

typedef long long           i64;
typedef unsigned long long  u64;

__attribute__((stdcall)) i64 rxdk_alldiv (i64 a, i64 b) __asm__("__alldiv");
__attribute__((stdcall)) u64 rxdk_aulldiv(u64 a, u64 b) __asm__("__aulldiv");
__attribute__((stdcall)) i64 rxdk_allrem (i64 a, i64 b) __asm__("__allrem");
__attribute__((stdcall)) u64 rxdk_aullrem(u64 a, u64 b) __asm__("__aullrem");
__attribute__((stdcall)) i64 rxdk_allmul (i64 a, i64 b) __asm__("__allmul");

__attribute__((stdcall)) i64 rxdk_alldiv (i64 a, i64 b) { return a / b; }
__attribute__((stdcall)) u64 rxdk_aulldiv(u64 a, u64 b) { return a / b; }
__attribute__((stdcall)) i64 rxdk_allrem (i64 a, i64 b) { return a % b; }
__attribute__((stdcall)) u64 rxdk_aullrem(u64 a, u64 b) { return a % b; }
__attribute__((stdcall)) i64 rxdk_allmul (i64 a, i64 b) { return a * b; }
