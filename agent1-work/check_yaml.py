import base64, subprocess
result = subprocess.run(
    ['gh', 'api', 'repos/chrbailey/restaurant-scheduler/contents/.github/workflows/release.yml', '--jq', '.content'],
    capture_output=True, text=True,
)
content = base64.b64decode(result.stdout).decode('utf-8')
lines = content.split('\n')
for i, line in enumerate(lines[:25], 1):
    print(f'{i:3}: {line!r}')
print('---')
print(f'Total lines: {len(lines)}')
print(f'Total bytes: {len(content)}')
# Look for name: Release at start
if content.startswith('name: Release'):
    print('Starts correctly with name: Release')
else:
    print(f'Starts with: {content[:50]!r}')
