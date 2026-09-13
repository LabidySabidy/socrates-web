# Course — Lab Fixture

```yaml
title: Lab Fixture
```

## Unit 1: Slopes and windows

### Group: Play

- **Module** (`interact`) Slope slider
- **Module** (`game`) Launch window

## Interactive: Slope slider

- **kind:** slider
- **fn:** m * x + b
- **xrange:** -6 | 6
- **param:** m | -4 | 4 | 0.5 | 1
- **param:** b | -4 | 4 | 0.5 | -2
- **caption:** Drag m to change the slope

## Game: Launch window

- **kind:** target-window
- **speed:** 0.9
- **band:** 44 | 56
- **caption:** Launch when the marker is inside the band
