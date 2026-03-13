import React, { useCallback } from 'react'
import { Pressable, PressableProps, GestureResponderEvent } from 'react-native'
import { logger } from '../utils/logger'

interface TrackedPressableProps extends PressableProps {
  logId?: string
  logScreen?: string
  logComponent?: string
}

function resolveLabel(props: TrackedPressableProps): string {
  if (props.logId) return props.logId
  if (props.accessibilityLabel && typeof props.accessibilityLabel === 'string') return props.accessibilityLabel
  if (props.testID) return props.testID
  return '(unlabeled)'
}

const TrackedPressable = React.forwardRef<
  React.ComponentRef<typeof Pressable>,
  TrackedPressableProps
>(({ logId, logScreen, logComponent, onPress, ...rest }, ref) => {
  const wrappedOnPress = useCallback(
    (e: GestureResponderEvent) => {
      if (__DEV__) {
        const label = resolveLabel({ logId, ...rest } as TrackedPressableProps)
        logger.tap(label, {
          screen: logScreen ?? '(unknown)',
          component: logComponent ?? '(unknown)',
        })
      }
      onPress?.(e)
    },
    [logId, logScreen, logComponent, onPress, rest.accessibilityLabel, rest.testID]
  )

  return <Pressable ref={ref} onPress={wrappedOnPress} {...rest} />
})

TrackedPressable.displayName = 'TrackedPressable'

export { TrackedPressable }
export type { TrackedPressableProps }
