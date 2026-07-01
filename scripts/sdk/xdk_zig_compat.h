/* Clang/Zig compatibility when including original Xbox SDK (MSVC) headers. */
#ifdef __clang__
#define _InterlockedIncrement InterlockedIncrement
#define _InterlockedDecrement InterlockedDecrement
#define _InterlockedExchange InterlockedExchange
#define _InterlockedExchangeAdd InterlockedExchangeAdd
#define _InterlockedCompareExchange InterlockedCompareExchange
#endif
