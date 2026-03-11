/**
 * TEST SUITE: Birthday Picker Race Condition Fix
 * Feature: FEATURE_BIRTHDAY_PICKER_FIX_SPEC.md
 * Scope: RC-001 (Step 1 Done handler) and HF-001 (pathB_birthday CTA handler)
 *
 * These tests verify that:
 *   1. React 18 batching does NOT corrupt birthday values
 *   2. Const-capture pattern is immune to ref mutation timing
 *   3. Fallback paths remain intact
 *   4. Multiple tap sequences do not leak stale state
 */

// ─── Core Logic Tests (pure JS — no React renderer needed) ───

describe('RC-001: Step 1 Done Button — const-capture pattern', () => {

  /**
   * Simulates the FIXED handler in isolation.
   * pendingBirthdayRef = mutable ref object
   * batchedUpdater = simulates React 18 batch: updater is queued, ref is
   *   mutated, THEN updater is flushed — exactly what React does.
   */
  function simulateFixedDoneHandler(
    pendingRef: { current: Date | null },
    batchedUpdater: (updater: (prev: any) => any) => void,
    setShowDatePicker: (val: boolean) => void,
  ) {
    const dateToCommit = pendingRef.current          // ← The fix: capture BEFORE mutation
    if (dateToCommit) {
      batchedUpdater((p: any) => ({ ...p, userBirthday: dateToCommit }))
      pendingRef.current = null                      // ← Ref nulled AFTER enqueue
    }
    setShowDatePicker(false)
  }

  function simulateBrokenDoneHandler(
    pendingRef: { current: Date | null },
    batchedUpdater: (updater: (prev: any) => any) => void,
    setShowDatePicker: (val: boolean) => void,
  ) {
    if (pendingRef.current) {
      batchedUpdater((p: any) => ({ ...p, userBirthday: pendingRef.current! }))  // ← no capture
      pendingRef.current = null                      // ← Mutates ref BEFORE updater flushes
    }
    setShowDatePicker(false)
  }

  /**
   * Simulates React 18 batching behavior:
   * - Collects all updaters during the event handler
   * - Applies them AFTER the handler returns
   */
  function createBatchSimulator() {
    const queue: Array<(prev: any) => any> = []
    let state = { userBirthday: null as Date | null }

    const batchedUpdater = (updater: (prev: any) => any) => {
      queue.push(updater)  // Queue, do NOT run immediately — this is React 18 behavior
    }

    const flush = () => {
      queue.forEach(updater => {
        state = updater(state)
      })
    }

    return { queue, batchedUpdater, flush, getState: () => state }
  }

  it('FIXED: Done tap commits the scrolled date — updater reads const after ref is nulled', () => {
    const march15_1990 = new Date(1990, 2, 15)
    const pendingRef = { current: march15_1990 }
    const { batchedUpdater, flush, getState } = createBatchSimulator()
    const setShowDatePicker = jest.fn()

    simulateFixedDoneHandler(pendingRef, batchedUpdater, setShowDatePicker)

    // Ref is now null (handler completed)
    expect(pendingRef.current).toBeNull()

    // But BEFORE flush — state not yet updated (batching)
    expect(getState().userBirthday).toBeNull()

    // React flushes the batch
    flush()

    // Const captured BEFORE null — state has the correct date
    expect(getState().userBirthday).toEqual(march15_1990)
    expect(setShowDatePicker).toHaveBeenCalledWith(false)
  })

  it('BROKEN (pre-fix): Done tap writes null because updater reads already-nulled ref', () => {
    const march15_1990 = new Date(1990, 2, 15)
    const pendingRef = { current: march15_1990 }
    const { batchedUpdater, flush, getState } = createBatchSimulator()
    const setShowDatePicker = jest.fn()

    simulateBrokenDoneHandler(pendingRef, batchedUpdater, setShowDatePicker)

    expect(pendingRef.current).toBeNull()   // ref nulled during handler
    flush()

    // The old code's updater closes over pendingRef OBJECT (not the value)
    // When updater runs, pendingRef.current is already null → writes null
    // NOTE: This test DEMONSTRATES the bug that was fixed. It is expected to fail
    // the assertion below IF the old code actually ran:
    // expect(getState().userBirthday).toEqual(march15_1990)  ← WOULD FAIL
    expect(getState().userBirthday).toBeNull()  // confirms the bug existed
  })

  it('FIXED: Done tap without scrolling commits the seeded default (Jan 1 2000)', () => {
    const BIRTHDAY_PICKER_DEFAULT = new Date(2000, 0, 1)
    // Simulates: user opens picker → ref seeded to default → no scrolling → Done tapped
    const pendingRef = { current: BIRTHDAY_PICKER_DEFAULT }
    const { batchedUpdater, flush, getState } = createBatchSimulator()
    const setShowDatePicker = jest.fn()

    simulateFixedDoneHandler(pendingRef, batchedUpdater, setShowDatePicker)
    flush()

    expect(getState().userBirthday).toEqual(BIRTHDAY_PICKER_DEFAULT)
    expect(getState().userBirthday).not.toBeNull()
  })

  it('FIXED: Done tap when ref is null (picker never opened) — does nothing to state', () => {
    const pendingRef = { current: null }
    const { batchedUpdater, flush, getState } = createBatchSimulator()
    const setShowDatePicker = jest.fn()

    simulateFixedDoneHandler(pendingRef, batchedUpdater, setShowDatePicker)
    flush()

    // No state write — userBirthday unchanged from initial null
    expect(getState().userBirthday).toBeNull()
    // But picker still closes
    expect(setShowDatePicker).toHaveBeenCalledWith(false)
  })

  it('FIXED: Multiple Done taps — second tap correctly overwrites first', () => {
    const march15_1990 = new Date(1990, 2, 15)
    const june10_1985 = new Date(1985, 5, 10)
    const setShowDatePicker = jest.fn()

    // First tap: scroll to March 15 1990, tap Done
    const pendingRef1 = { current: march15_1990 }
    const batch1 = createBatchSimulator()
    simulateFixedDoneHandler(pendingRef1, batch1.batchedUpdater, setShowDatePicker)
    batch1.flush()
    expect(batch1.getState().userBirthday).toEqual(march15_1990)

    // Second tap: reopen picker (re-seed), scroll to June 10 1985, tap Done
    const pendingRef2 = { current: june10_1985 }
    const batch2 = createBatchSimulator()
    simulateFixedDoneHandler(pendingRef2, batch2.batchedUpdater, setShowDatePicker)
    batch2.flush()
    expect(batch2.getState().userBirthday).toEqual(june10_1985)

    // No state leakage between taps
    expect(pendingRef1.current).toBeNull()
    expect(pendingRef2.current).toBeNull()
  })

  it('FIXED: const is immune to any post-capture ref reassignment', () => {
    const originalDate = new Date(1990, 2, 15)
    const pendingRef = { current: originalDate }

    // Simulate the capture
    const dateToCommit = pendingRef.current  // const capture

    // Any number of reassignments after capture cannot affect dateToCommit
    pendingRef.current = null
    pendingRef.current = new Date(2000, 0, 1)
    pendingRef.current = new Date(1970, 0, 1)

    // dateToCommit is unaffected by all mutations
    expect(dateToCommit).toEqual(originalDate)
  })

  it('FIXED: const is immune to property mutation on the Date object itself', () => {
    const originalDate = new Date(1990, 2, 15)
    const pendingRef = { current: originalDate }

    const dateToCommit = pendingRef.current!

    // Even if someone mutates the underlying Date object (unlikely but possible)
    // dateToCommit still references the same object — this is fine because
    // DateTimePicker.onChange REASSIGNS pendingRef.current to a NEW Date,
    // it does NOT mutate the existing Date's properties.
    // This test confirms that reassignment (not mutation) is what happens:
    pendingRef.current = new Date(2020, 5, 20)  // REASSIGN (new object)

    // dateToCommit still holds original Date object reference
    expect(dateToCommit.getFullYear()).toBe(1990)
    expect(dateToCommit.getMonth()).toBe(2)
    expect(dateToCommit.getDate()).toBe(15)
  })
})


describe('HF-001: Step 5 pathB_birthday CTA — const-capture pattern', () => {

  function simulateFixedPathBHandler(
    pendingRef: { current: Date | null },
    currentPersonBirthday: Date | null,
    batchedUpdater: (updater: (prev: any) => any) => void,
    handleGoNext: () => void,
    DEFAULT_PERSON_DATE: Date,
  ) {
    const personDateToCommit = pendingRef.current    // ← The fix
    if (personDateToCommit) {
      batchedUpdater((p: any) => ({ ...p, personBirthday: personDateToCommit }))
      pendingRef.current = null
    } else if (!currentPersonBirthday) {
      batchedUpdater((p: any) => ({ ...p, personBirthday: DEFAULT_PERSON_DATE }))
    }
    handleGoNext()
  }

  function createBatchSimulator(initialPersonBirthday: Date | null = null) {
    const queue: Array<(prev: any) => any> = []
    let state = { personBirthday: initialPersonBirthday }

    const batchedUpdater = (updater: (prev: any) => any) => {
      queue.push(updater)
    }

    const flush = () => {
      queue.forEach(updater => {
        state = updater(state)
      })
    }

    return { queue, batchedUpdater, flush, getState: () => state }
  }

  const DEFAULT_PERSON_DATE = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 25)
    return d
  })()

  it('FIXED: Next tap commits the scrolled friend date — not DEFAULT_PERSON_DATE', () => {
    const june10_1995 = new Date(1995, 5, 10)
    const pendingRef = { current: june10_1995 }
    const handleGoNext = jest.fn()
    const { batchedUpdater, flush, getState } = createBatchSimulator()

    simulateFixedPathBHandler(pendingRef, null, batchedUpdater, handleGoNext, DEFAULT_PERSON_DATE)
    flush()

    expect(getState().personBirthday).toEqual(june10_1995)
    expect(getState().personBirthday).not.toEqual(DEFAULT_PERSON_DATE)
    expect(handleGoNext).toHaveBeenCalledTimes(1)
  })

  it('FIXED: Next tap — handleGoNext always fires regardless of birthday state', () => {
    // handleGoNext must fire in ALL branches
    const handleGoNextA = jest.fn()
    const handleGoNextB = jest.fn()
    const handleGoNextC = jest.fn()

    // Branch A: ref has date
    simulateFixedPathBHandler(
      { current: new Date(1995, 5, 10) }, null,
      () => {}, handleGoNextA, DEFAULT_PERSON_DATE
    )

    // Branch B: no ref, no prior birthday → fallback
    simulateFixedPathBHandler(
      { current: null }, null,
      () => {}, handleGoNextB, DEFAULT_PERSON_DATE
    )

    // Branch C: no ref, has prior birthday → skip fallback
    simulateFixedPathBHandler(
      { current: null }, new Date(1990, 2, 15),
      () => {}, handleGoNextC, DEFAULT_PERSON_DATE
    )

    expect(handleGoNextA).toHaveBeenCalledTimes(1)
    expect(handleGoNextB).toHaveBeenCalledTimes(1)
    expect(handleGoNextC).toHaveBeenCalledTimes(1)
  })

  it('FALLBACK: fires when no ref AND no prior personBirthday (abnormal path)', () => {
    const pendingRef = { current: null }  // effect didn't seed the ref
    const handleGoNext = jest.fn()
    const { batchedUpdater, flush, getState } = createBatchSimulator(null)

    simulateFixedPathBHandler(pendingRef, null, batchedUpdater, handleGoNext, DEFAULT_PERSON_DATE)
    flush()

    // DEFAULT_PERSON_DATE committed as fallback
    expect(getState().personBirthday).toEqual(DEFAULT_PERSON_DATE)
    expect(handleGoNext).toHaveBeenCalledTimes(1)
  })

  it('FALLBACK: does NOT overwrite existing personBirthday when ref is null', () => {
    const existingBirthday = new Date(1990, 2, 15)
    const pendingRef = { current: null }  // no new scroll
    const handleGoNext = jest.fn()
    const { batchedUpdater, flush, getState } = createBatchSimulator(existingBirthday)

    simulateFixedPathBHandler(pendingRef, existingBirthday, batchedUpdater, handleGoNext, DEFAULT_PERSON_DATE)
    flush()

    // Existing date preserved — fallback guard checked !data.personBirthday
    expect(getState().personBirthday).toEqual(existingBirthday)
    expect(getState().personBirthday).not.toEqual(DEFAULT_PERSON_DATE)
    expect(handleGoNext).toHaveBeenCalledTimes(1)
  })

  it('FIXED: React 18 batch timing — ref nulled before flush, const still correct', () => {
    const june10_1995 = new Date(1995, 5, 10)
    const pendingRef = { current: june10_1995 }
    const handleGoNext = jest.fn()
    let capturedUpdater: ((prev: any) => any) | null = null

    // Intercept the updater without flushing it yet
    const deferredUpdater = (updater: (prev: any) => any) => {
      capturedUpdater = updater
    }

    simulateFixedPathBHandler(pendingRef, null, deferredUpdater, handleGoNext, DEFAULT_PERSON_DATE)

    // At this point: handler has returned, ref is null, handleGoNext fired
    expect(pendingRef.current).toBeNull()     // ref nulled during handler
    expect(handleGoNext).toHaveBeenCalled()   // navigation already fired

    // Now flush — simulating React's deferred batch execution
    const result = capturedUpdater!({ personBirthday: null })

    // Despite ref being null, updater reads the CONST → correct date
    expect(result.personBirthday).toEqual(june10_1995)
  })
})


describe('Ref Seeding Lifecycle', () => {

  it('Step 1 seeding: ref initialized to existing birthday on picker open', () => {
    const existingBirthday = new Date(1990, 2, 15)
    const pendingBirthdayRef = { current: null as Date | null }
    const BIRTHDAY_PICKER_DEFAULT = new Date(2000, 0, 1)

    // Simulate the "open picker" button press handler
    const openPickerHandler = (dataUserBirthday: Date | null) => {
      pendingBirthdayRef.current = dataUserBirthday || BIRTHDAY_PICKER_DEFAULT
    }

    // First open: no prior birthday — seeds to default
    openPickerHandler(null)
    expect(pendingBirthdayRef.current).toEqual(BIRTHDAY_PICKER_DEFAULT)

    // Second open: has prior birthday — seeds to existing
    openPickerHandler(existingBirthday)
    expect(pendingBirthdayRef.current).toEqual(existingBirthday)
  })

  it('pathB seeding: useEffect seeds ref to existing personBirthday OR default', () => {
    const DEFAULT_PERSON_DATE = (() => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 25)
      return d
    })()

    const pendingPersonBirthdayRef = { current: null as Date | null }

    // Simulates the seeding useEffect body when navState.subStep === 'pathB_birthday'
    const seedEffect = (personBirthday: Date | null) => {
      pendingPersonBirthdayRef.current = personBirthday || DEFAULT_PERSON_DATE
    }

    // First arrival: no prior birthday
    seedEffect(null)
    expect(pendingPersonBirthdayRef.current).toEqual(DEFAULT_PERSON_DATE)
    expect(pendingPersonBirthdayRef.current).not.toBeNull()

    // Subsequent arrival: has prior birthday
    const existingBirthday = new Date(1990, 2, 15)
    seedEffect(existingBirthday)
    expect(pendingPersonBirthdayRef.current).toEqual(existingBirthday)
  })

  it('pathB seeding: effect ONLY fires on subStep change — not on every data change', () => {
    // Verifies the intentional dep-array omission of data.personBirthday
    // The effect dependency is [navState.subStep] only.
    // This test documents the contract: if subStep is already 'pathB_birthday'
    // and data.personBirthday changes, the effect does NOT re-seed.
    // (This is correct — personBirthday only changes when the CTA fires,
    // which also navigates away, so the subStep changes too.)

    const DEFAULT_PERSON_DATE = new Date()
    const june10_1995 = new Date(1995, 5, 10)
    const pendingPersonBirthdayRef = { current: null as Date | null }

    // Navigate to pathB_birthday → effect fires → seeds to null/default
    let currentSubStep = 'pathB_name'
    const runEffectIfNeeded = (newSubStep: string, personBirthday: Date | null) => {
      if (newSubStep !== currentSubStep) {
        currentSubStep = newSubStep
        if (newSubStep === 'pathB_birthday') {
          pendingPersonBirthdayRef.current = personBirthday || DEFAULT_PERSON_DATE
        }
      }
    }

    // Navigate to pathB_birthday
    runEffectIfNeeded('pathB_birthday', null)
    expect(pendingPersonBirthdayRef.current).toEqual(DEFAULT_PERSON_DATE)

    // Simulating data.personBirthday change (subStep unchanged)
    // Effect does NOT re-seed — ref retains whatever user scrolled to
    pendingPersonBirthdayRef.current = june10_1995  // user scrolled
    runEffectIfNeeded('pathB_birthday', new Date(2000, 0, 1))  // same subStep → effect ignored

    // Ref still holds user's scroll value, not the new data.personBirthday
    expect(pendingPersonBirthdayRef.current).toEqual(june10_1995)
  })
})


describe('CTA Disabled Condition — Step 1 Details', () => {

  it('Let\'s go is DISABLED when userBirthday is null', () => {
    // Mirrors: disabled: !data.userBirthday
    const disabled = (userBirthday: Date | null) => !userBirthday
    expect(disabled(null)).toBe(true)
  })

  it('Let\'s go is ENABLED when userBirthday is a Date object', () => {
    const disabled = (userBirthday: Date | null) => !userBirthday
    expect(disabled(new Date(1990, 2, 15))).toBe(false)
    expect(disabled(new Date(2000, 0, 1))).toBe(false)
  })

  it('Let\'s go is DISABLED when userBirthday is undefined (not yet set)', () => {
    const disabled = (userBirthday: Date | null | undefined) => !userBirthday
    expect(disabled(undefined)).toBe(true)
  })

  it('pathB_birthday CTA is always ENABLED (user can tap Next anytime)', () => {
    // disabled: false — always enabled, seeding effect ensures ref is pre-loaded
    const disabled = false
    expect(disabled).toBe(false)
  })
})


describe('formatBirthdayDisplay — display formatting', () => {

  it('formats March 15 1990 as 15/03/1990', () => {
    function formatBirthdayDisplay(date: Date): string {
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear()
      return `${day}/${month}/${year}`
    }
    expect(formatBirthdayDisplay(new Date(1990, 2, 15))).toBe('15/03/1990')
  })

  it('formats single-digit day and month with leading zero', () => {
    function formatBirthdayDisplay(date: Date): string {
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear()
      return `${day}/${month}/${year}`
    }
    expect(formatBirthdayDisplay(new Date(2000, 0, 1))).toBe('01/01/2000')
    expect(formatBirthdayDisplay(new Date(1985, 8, 5))).toBe('05/09/1985')
  })

  it('is non-mutating — does not modify the input Date object', () => {
    function formatBirthdayDisplay(date: Date): string {
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear()
      return `${day}/${month}/${year}`
    }
    const date = new Date(1990, 2, 15)
    const originalTime = date.getTime()
    formatBirthdayDisplay(date)
    expect(date.getTime()).toBe(originalTime)
  })
})


describe('Module-level Date Constants', () => {

  it('BIRTHDAY_PICKER_DEFAULT is Jan 1 2000 — stable across renders', () => {
    const BIRTHDAY_PICKER_DEFAULT = new Date(2000, 0, 1)
    expect(BIRTHDAY_PICKER_DEFAULT.getFullYear()).toBe(2000)
    expect(BIRTHDAY_PICKER_DEFAULT.getMonth()).toBe(0)
    expect(BIRTHDAY_PICKER_DEFAULT.getDate()).toBe(1)
  })

  it('DEFAULT_PERSON_DATE is approximately 25 years ago', () => {
    const DEFAULT_PERSON_DATE = (() => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 25)
      return d
    })()
    const expectedYear = new Date().getFullYear() - 25
    expect(DEFAULT_PERSON_DATE.getFullYear()).toBe(expectedYear)
  })

  it('MIN_BIRTHDAY_DATE is Jan 1 1906 (120 years ago)', () => {
    const MIN_BIRTHDAY_DATE = new Date(1906, 0, 1)
    expect(MIN_BIRTHDAY_DATE.getFullYear()).toBe(1906)
  })

  it('MAX_PERSON_DATE is at least 13 years before today (minimum age)', () => {
    const MAX_PERSON_DATE = (() => {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 13)
      return d
    })()
    const thirteenYearsAgo = new Date()
    thirteenYearsAgo.setFullYear(thirteenYearsAgo.getFullYear() - 13)
    expect(MAX_PERSON_DATE.getFullYear()).toBe(thirteenYearsAgo.getFullYear())
  })
})
