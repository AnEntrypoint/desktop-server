# @sequential/desktop-server

Modular Express server for Sequential Desktop with app registry, plugin system, and dynamic app discovery.

## Installation

```bash
npm install @sequential/desktop-server
```

## Usage

```javascript
import {{ DesktopServer }} from '@sequential/desktop-server';

const service = new DesktopServer({{ /* config */ }});
const result = await service.execute(input);
```

## API

### Methods

- `execute(input)` - Execute service operation
- `validate(input)` - Validate input against schema
- `getStatus()` - Get service status

## Configuration

Service behavior controlled via configuration:

```javascript
{{
  timeout: 5000,
  retries: 3,
  debug: false
}}
```

## Error Handling

Uses standardized error handling from [@sequential/error-handling](../error-handling):

```javascript
try {{
  const result = await service.execute(input);
}} catch (error) {{
  console.error(error.message);
}}
```

## Related Packages

- [@sequential/task-execution-service](../task-execution-service) - Task execution
- [@sequential/error-handling](../error-handling) - Error handling

## License

MIT
