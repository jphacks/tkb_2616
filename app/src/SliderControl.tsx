import Slider from '@react-native-community/slider';

export type SliderControlProps = {
  value: number; max: number; color: string; trackColor: string;
  label: string; valueText: string; height: number; onChange: (value: number) => void;
};

export function SliderControl({ value, max, color, trackColor, label, valueText, height, onChange }: SliderControlProps) {
  return <Slider style={{ flex: 1, height }} value={value} minimumValue={0} maximumValue={max}
    step={0} minimumTrackTintColor={color} maximumTrackTintColor={trackColor} thumbTintColor={color}
    tapToSeek accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: value, text: valueText }}
    onSlidingComplete={next => onChange(Math.round(next))} />;
}
