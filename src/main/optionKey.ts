/** Carbon/HIToolbox virtual key codes for Option (Mac Alt). */
export const MAC_KEY_LEFT_OPTION = 0x3a
export const MAC_KEY_RIGHT_OPTION = 0x3d

export function isOptionDown(isDown: (macKeyCode: number) => boolean): boolean {
  return isDown(MAC_KEY_LEFT_OPTION) || isDown(MAC_KEY_RIGHT_OPTION)
}
