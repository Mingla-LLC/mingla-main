import React, { useCallback } from 'react'
import { TouchableOpacity, TouchableOpacityProps, GestureResponderEvent } from 'react-native'
import { breadcrumbs } from '../utils/breadcrumbs'

interface TrackedTouchableOpacityProps extends TouchableOpacityProps {
  /** Explicit label for the log entry. If omitted, falls back to accessibilityLabel, testID, or "(unlabeled)". */
  logId?: string
  /** Optional screen context. If omitted, defaults to "(unknown)". Set by parent screens. */
  logScreen?: string
  /** Optional component context. Auto-detected from parent displayName in dev, or set explicitly. */
  logComponent?: string
}

function resolveLabel(props: TrackedTouchableOpacityProps): string {
  if (props.logId) return props.logId
  if (props.accessibilityLabel && typeof props.accessibilityLabel === 'string') return props.accessibilityLabel
  if (props.testID) return props.testID
  // Try to extract text from children
  if (props.children) {
    const text = extractChildText(props.children)
    if (text) return text
  }
  return '(unlabeled)'
}

/** Recursively extract text content from React children for auto-labeling. */
function extractChildText(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) {
    for (const child of children) {
      const text = extractChildText(child)
      if (text) return text
    }
    return null
  }
  if (React.isValidElement(children)) {
    const childProps = children.props as Record<string, unknown>
    if (childProps?.children) {
      return extractChildText(childProps.children as React.ReactNode)
    }
  }
  return null
}

const TrackedTouchableOpacity = React.forwardRef<
  React.ComponentRef<typeof TouchableOpacity>,
  TrackedTouchableOpacityProps
>(({ logId, logScreen, logComponent, onPress, ...rest }, ref) => {
  const wrappedOnPress = useCallback(
    (e: GestureResponderEvent) => {
      if (__DEV__) {
        const label = resolveLabel({ logId, ...rest } as TrackedTouchableOpacityProps)
        const screen = logScreen ?? '(unknown)'
        const component = logComponent ?? '(unknown)'
        breadcrumbs.add('tap', label, { screen, component })
        console.log(`[TAP] ${label} | screen=${screen} | component=${component}`)
      }
      onPress?.(e)
    },
    [logId, logScreen, logComponent, onPress, rest.accessibilityLabel, rest.testID]
  )

  return <TouchableOpacity ref={ref} onPress={wrappedOnPress} {...rest} />
})

TrackedTouchableOpacity.displayName = 'TrackedTouchableOpacity'

export { TrackedTouchableOpacity }
export type { TrackedTouchableOpacityProps }
