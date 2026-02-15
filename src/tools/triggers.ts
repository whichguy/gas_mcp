import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from './base.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { ExecTool } from './execution.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Escape a string for safe interpolation into GAS code templates.
 * Prevents code injection via user-controlled inputs (functionName, triggerId, etc.).
 */
function escapeGasString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Unified trigger management tool for Google Apps Script projects
 * Provides comprehensive trigger operations: list, create, delete
 */
export class TriggerTool extends BaseTool {
  public name = 'trigger';
  public description = '[TRIGGER] Manage Apps Script triggers — list, create, and delete time-based or event-driven triggers. WHEN: scheduling functions or setting up event handlers (onEdit, onOpen, etc.). AVOID: use __events__ for onOpen/onEdit triggers; trigger tool for time-based and installable triggers. Example: trigger({scriptId, operation: "list"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', description: 'Operation performed (list, create, delete)' },
      triggers: { type: 'array', description: 'List of triggers (list operation)' },
      totalTriggers: { type: 'number', description: 'Total trigger count (list)' },
      triggerId: { type: 'string', description: 'Created or deleted trigger ID' },
      functionName: { type: 'string', description: 'Function associated with trigger' },
      triggerType: { type: 'string', description: 'Type of trigger created' },
      deleted: { type: 'number', description: 'Number of triggers deleted (delete)' },
      status: { type: 'string', description: 'Operation status' }
    }
  };

  public inputSchema = {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'create', 'delete'],
        description: 'Trigger operation: list (show all triggers), create (new trigger), delete (remove trigger)'
      },
      ...SchemaFragments.accessToken,
      ...SchemaFragments.scriptId,
      // List operation parameters
      detailed: {
        type: 'boolean',
        default: false,
        description: 'Include detailed trigger information (function names, sources, IDs) - for list operation'
      },
      // Create operation parameters
      functionName: {
        type: 'string',
        description: 'Name of the function to be executed by the trigger - required for create operation, optional for delete',
        minLength: 1
      },
      triggerType: {
        type: 'string',
        enum: ['time', 'spreadsheet', 'form', 'calendar', 'document', 'addon', 'gmail'],
        description: 'Type of trigger. Most common: time (scheduled), spreadsheet (onEdit/onChange). Required for create.',
      },
      // Delete operation parameters
      triggerId: {
        type: 'string',
        description: 'Unique ID of the trigger to delete - for delete operation (optional if functionName provided)'
      },
      deleteAll: {
        type: 'boolean',
        default: false,
        description: 'Delete ALL triggers in the project - for delete operation (use with caution)'
      },
      // Enhanced time-based trigger options
      timeOptions: {
        type: 'object',
        description: 'Options for time-based triggers (required if triggerType is "time")',
        properties: {
          interval: {
            type: 'string',
            enum: ['minutes', 'hours', 'days', 'weeks', 'monthly', 'yearly', 'specific'],
            description: 'Time interval type'
          },
          value: {
            type: 'number',
            description: 'Interval value (minutes: 1,5,10,15,30; hours: 1-12; days/weeks/months/years: any positive number)'
          },
          specificDate: {
            type: 'string',
            description: 'Specific date in ISO format (YYYY-MM-DDTHH:mm:ss) for one-time triggers'
          },
          weekDay: {
            type: 'string',
            enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
            description: 'Day of week for weekly triggers'
          },
          monthDay: {
            type: 'number',
            minimum: 1,
            maximum: 31,
            description: 'Day of month (1-31) for monthly triggers'
          },
          hour: {
            type: 'number',
            minimum: 0,
            maximum: 23,
            description: 'Hour of day (0-23) for daily/weekly/monthly triggers'
          },
          minute: {
            type: 'number',
            minimum: 0,
            maximum: 59,
            description: 'Minute of hour (0-59) for precise timing'
          },
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., "America/New_York", "Europe/London") for time-based triggers'
          }
        }
      },
      // Enhanced spreadsheet trigger options
      spreadsheetOptions: {
        type: 'object',
        description: 'Options for spreadsheet-based triggers',
        properties: {
          spreadsheetId: {
            type: 'string',
            description: 'Spreadsheet ID for spreadsheet triggers (optional - uses active sheet if not provided)'
          },
          sheetName: {
            type: 'string',
            description: 'Target specific sheet name within the spreadsheet'
          },
          eventType: {
            type: 'string',
            enum: ['onOpen', 'onEdit', 'onChange', 'onFormSubmit', 'onSelectionChange'],
            description: 'Type of spreadsheet event'
          },
          range: {
            type: 'string',
            description: 'Cell range (e.g., "A1:D10") for range-based edit triggers'
          }
        },
        required: ['eventType']
      },
      // Enhanced form trigger options
      formOptions: {
        type: 'object',
        description: 'Options for form-based triggers',
        properties: {
          formId: {
            type: 'string',
            description: 'Google Form ID for form triggers'
          },
          eventType: {
            type: 'string',
            enum: ['onFormSubmit', 'onFormOpen'],
            description: 'Type of form event'
          }
        },
        required: ['formId', 'eventType']
      },
      // Enhanced calendar trigger options
      calendarOptions: {
        type: 'object',
        description: 'Options for calendar-based triggers',
        properties: {
          calendarId: {
            type: 'string',
            description: 'Specific calendar ID (use "primary" for default calendar)'
          },
          calendarName: {
            type: 'string',
            description: 'Calendar name (alternative to calendarId)'
          },
          eventType: {
            type: 'string',
            enum: ['onEventUpdated', 'onEventCreated', 'onEventDeleted'],
            description: 'Type of calendar event'
          }
        },
        required: ['eventType']
      },
      // Document trigger options
      documentOptions: {
        type: 'object',
        description: 'Options for Google Docs document triggers',
        properties: {
          documentId: {
            type: 'string',
            description: 'Google Docs document ID'
          },
          eventType: {
            type: 'string',
            enum: ['onOpen', 'onEdit'],
            description: 'Type of document event'
          }
        },
        required: ['documentId', 'eventType']
      },
      // Add-on trigger options
      addonOptions: {
        type: 'object',
        description: 'Options for add-on lifecycle triggers',
        properties: {
          eventType: {
            type: 'string',
            enum: ['onInstall', 'onEnable', 'onDisable'],
            description: 'Type of add-on lifecycle event'
          }
        },
        required: ['eventType']
      },
      // Gmail add-on trigger options
      gmailOptions: {
        type: 'object',
        description: 'Options for Gmail add-on triggers',
        properties: {
          eventType: {
            type: 'string',
            enum: ['onGmailMessage', 'onGmailDraft', 'onGmailThread'],
            description: 'Type of Gmail event'
          },
          labelName: {
            type: 'string',
            description: 'Gmail label name to filter messages (optional)'
          }
        },
        required: ['eventType']
      }
    },
    required: ['operation', 'scriptId'],
    additionalProperties: false,
    llmGuidance: {
      operations: 'list (detailed:true for IDs) | create (triggerType+options) | delete (triggerId/functionName/deleteAll)',
      triggerTypes: 'time: scheduled | spreadsheet: onEdit/onChange/onFormSubmit | form/calendar/document/addon/gmail',
      limitations: 'Max 20 triggers/user/script | onEdit=user edits only | calendar=onEventUpdated only | Docs=onOpen only'
    }
  };

  public annotations = {
    title: 'Trigger Manager',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true
  };

  async execute(args: any): Promise<any> {
    const { operation, scriptId, accessToken } = args;

    // Route to appropriate operation
    switch (operation) {
      case 'list':
        return this.listTriggers(args);
      case 'create':
        return this.createTrigger(args);
      case 'delete':
        return this.deleteTrigger(args);
      default:
        throw new ValidationError('operation', operation, 'one of: list, create, delete');
    }
  }

  private async listTriggers(args: any): Promise<any> {
    const { scriptId, detailed = false, accessToken } = args;

    try {
      // Create the JavaScript statement to list triggers
      const jsStatement = `
        (function() {
          const triggers = ScriptApp.getProjectTriggers();
          const result = {
            totalTriggers: triggers.length,
            triggers: []
          };

          if (triggers.length > 0) {
            for (let i = 0; i < triggers.length; i++) {
              const trigger = triggers[i];
              const triggerInfo = {
                uniqueId: trigger.getUniqueId(),
                handlerFunction: trigger.getHandlerFunction(),
                triggerSource: trigger.getTriggerSource().toString(),
                ${detailed ? `
                triggerSourceId: trigger.getTriggerSourceId() || null,
                eventType: trigger.getEventType() ? trigger.getEventType().toString() : null,
                ` : ''}
              };
              result.triggers.push(triggerInfo);
            }
          }

          return JSON.stringify(result, null, 2);
        })()
      `;

      // Execute using exec
      const gasExecTool = new ExecTool(this.sessionAuthManager);
      const runResult = await gasExecTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      return {
        success: true,
        operation: 'list',
        ...JSON.parse(runResult.result)
      };

    } catch (error: any) {
      throw new GASApiError(
        `Failed to list triggers: ${error.message}`,
        undefined,
        { scriptId, error: error.message }
      );
    }
  }

  private async createTrigger(args: any): Promise<any> {
    const {
      scriptId,
      functionName,
      triggerType,
      timeOptions,
      spreadsheetOptions,
      formOptions,
      calendarOptions,
      documentOptions,
      addonOptions,
      gmailOptions,
      accessToken
    } = args;

    try {
      let jsStatement = '';

      switch (triggerType) {
        case 'time':
          jsStatement = this.buildTimeBasedTrigger(functionName, timeOptions);
          break;
        case 'spreadsheet':
          jsStatement = this.buildSpreadsheetTrigger(functionName, spreadsheetOptions);
          break;
        case 'form':
          jsStatement = this.buildFormTrigger(functionName, formOptions);
          break;
        case 'calendar':
          jsStatement = this.buildCalendarTrigger(functionName, calendarOptions);
          break;
        case 'document':
          jsStatement = this.buildDocumentTrigger(functionName, documentOptions);
          break;
        case 'addon':
          jsStatement = this.buildAddonTrigger(functionName, addonOptions);
          break;
        case 'gmail':
          jsStatement = this.buildGmailTrigger(functionName, gmailOptions);
          break;
        default:
          throw new Error(`Unsupported trigger type: ${triggerType}`);
      }

      // Execute using exec
      const gasExecTool = new ExecTool(this.sessionAuthManager);
      const runResult = await gasExecTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      return {
        success: true,
        operation: 'create',
        message: `Successfully created ${triggerType} trigger for function '${functionName}'`,
        result: runResult.result
      };

    } catch (error: any) {
      throw new GASApiError(
        `Failed to create trigger: ${error.message}`,
        undefined,
        { scriptId, functionName, triggerType, error: error.message }
      );
    }
  }

  private async deleteTrigger(args: any): Promise<any> {
    const { scriptId, triggerId, functionName, deleteAll = false, accessToken } = args;

    if (!triggerId && !functionName && !deleteAll) {
      throw new ValidationError(
        'parameters',
        { triggerId, functionName, deleteAll },
        'either triggerId, functionName, or deleteAll to be true'
      );
    }

    try {
      let jsStatement = '';

      if (deleteAll) {
        jsStatement = `
          (function() {
            try {
              const triggers = ScriptApp.getProjectTriggers();
              let deletedCount = 0;

              triggers.forEach(trigger => {
                ScriptApp.deleteTrigger(trigger);
                deletedCount++;
              });

              return {
                success: true,
                deletedCount: deletedCount,
                message: \`Deleted \${deletedCount} triggers\`
              };
            } catch (error) {
              return {
                success: false,
                error: error.toString()
              };
            }
          })()
        `;
      } else if (triggerId) {
        const safeTriggerId = escapeGasString(triggerId);
        jsStatement = `
          (function() {
            try {
              const triggers = ScriptApp.getProjectTriggers();
              const trigger = triggers.find(t => t.getUniqueId() === '${safeTriggerId}');

              if (!trigger) {
                return {
                  success: false,
                  error: 'Trigger with ID ${safeTriggerId} not found'
                };
              }

              ScriptApp.deleteTrigger(trigger);
              return {
                success: true,
                message: 'Trigger deleted successfully',
                deletedTriggerId: '${safeTriggerId}'
              };
            } catch (error) {
              return {
                success: false,
                error: error.toString()
              };
            }
          })()
        `;
      } else if (functionName) {
        const safeFunctionName = escapeGasString(functionName);
        jsStatement = `
          (function() {
            try {
              const triggers = ScriptApp.getProjectTriggers();
              const matchingTriggers = triggers.filter(t => t.getHandlerFunction() === '${safeFunctionName}');

              if (matchingTriggers.length === 0) {
                return {
                  success: false,
                  error: 'No triggers found for function ${safeFunctionName}'
                };
              }

              matchingTriggers.forEach(trigger => {
                ScriptApp.deleteTrigger(trigger);
              });

              return {
                success: true,
                deletedCount: matchingTriggers.length,
                message: \`Deleted \${matchingTriggers.length} triggers for function ${safeFunctionName}\`
              };
            } catch (error) {
              return {
                success: false,
                error: error.toString()
              };
            }
          })()
        `;
      }

      // Execute using exec
      const gasExecTool = new ExecTool(this.sessionAuthManager);
      const runResult = await gasExecTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      const result = JSON.parse(runResult.result);
      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        ...result,
        operation: 'delete'
      };

    } catch (error: any) {
      throw new GASApiError(
        `Failed to delete trigger(s): ${error.message}`,
        undefined,
        { scriptId, triggerId, functionName, deleteAll, error: error.message }
      );
    }
  }

  // Helper methods for building trigger creation statements
  private buildTimeBasedTrigger(functionName: string, options: any): string {
    if (!options) {
      throw new Error('timeOptions are required for time-based triggers');
    }

    const { interval, value, specificDate, weekDay, monthDay, hour, minute, timezone } = options;
    const safeFunctionName = escapeGasString(functionName);

    let triggerBuilder = `ScriptApp.newTrigger('${safeFunctionName}').timeBased()`;

    switch (interval) {
      case 'minutes':
        if (![1, 5, 10, 15, 30].includes(value)) {
          throw new Error('Minutes value must be 1, 5, 10, 15, or 30');
        }
        triggerBuilder += `.everyMinutes(${value})`;
        break;
      case 'hours':
        if (value < 1 || value > 12) {
          throw new Error('Hours value must be between 1 and 12');
        }
        triggerBuilder += `.everyHours(${value})`;
        break;
      case 'days':
        triggerBuilder += `.everyDays(${value || 1})`;
        if (hour !== undefined) {
          triggerBuilder += `.atHour(${hour})`;
        }
        if (minute !== undefined) {
          triggerBuilder += `.nearTime(${hour || 0}, ${minute})`;
        }
        break;
      case 'weeks':
        triggerBuilder += `.everyWeeks(${value || 1})`;
        if (weekDay) {
          triggerBuilder += `.onWeekDay(ScriptApp.WeekDay.${weekDay})`;
        }
        if (hour !== undefined) {
          triggerBuilder += `.atHour(${hour})`;
        }
        if (minute !== undefined) {
          triggerBuilder += `.nearTime(${hour || 0}, ${minute})`;
        }
        break;
      case 'monthly':
        if (!monthDay) {
          throw new Error('monthDay is required for monthly triggers');
        }
        triggerBuilder += `.onMonthDay(${monthDay})`;
        if (hour !== undefined) {
          triggerBuilder += `.atHour(${hour})`;
        }
        if (minute !== undefined) {
          triggerBuilder += `.nearTime(${hour || 0}, ${minute})`;
        }
        break;
      case 'yearly':
        if (!monthDay) {
          throw new Error('monthDay is required for yearly triggers');
        }
        // Note: Apps Script doesn't have direct yearly triggers, we'll use monthly recurring
        triggerBuilder += `.onMonthDay(${monthDay})`;
        if (hour !== undefined) {
          triggerBuilder += `.atHour(${hour})`;
        }
        if (minute !== undefined) {
          triggerBuilder += `.nearTime(${hour || 0}, ${minute})`;
        }
        break;
      case 'specific':
        if (!specificDate) {
          throw new Error('specificDate is required for one-time triggers');
        }
        triggerBuilder += `.at(new Date('${escapeGasString(specificDate)}'))`;
        break;
      default:
        throw new Error(`Unsupported time interval: ${interval}`);
    }

    // Add timezone support if provided
    if (timezone && interval !== 'specific') {
      triggerBuilder += `.inTimezone('${escapeGasString(timezone)}')`;
    }

    return `
      (function() {
        try {
          const trigger = ${triggerBuilder}.create();
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Time-based trigger created successfully',
            details: {
              interval: '${escapeGasString(interval)}',
              ${value ? `value: ${value},` : ''}
              ${weekDay ? `weekDay: '${escapeGasString(String(weekDay))}',` : ''}
              ${monthDay ? `monthDay: ${monthDay},` : ''}
              ${hour !== undefined ? `hour: ${hour},` : ''}
              ${minute !== undefined ? `minute: ${minute},` : ''}
              ${timezone ? `timezone: '${escapeGasString(timezone)}'` : ''}
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildSpreadsheetTrigger(functionName: string, options: any): string {
    if (!options || !options.eventType) {
      throw new Error('spreadsheetOptions with eventType are required for spreadsheet triggers');
    }

    const { spreadsheetId, sheetName, eventType, range } = options;
    const safeFunctionName = escapeGasString(functionName);

    let spreadsheetRef = spreadsheetId
      ? `SpreadsheetApp.openById('${escapeGasString(spreadsheetId)}')`
      : 'SpreadsheetApp.getActive()';

    let triggerBuilder = `ScriptApp.newTrigger('${safeFunctionName}').forSpreadsheet(${spreadsheetRef})`;

    switch (eventType) {
      case 'onOpen':
        triggerBuilder += '.onOpen()';
        break;
      case 'onEdit':
        triggerBuilder += '.onEdit()';
        break;
      case 'onChange':
        triggerBuilder += '.onChange()';
        break;
      case 'onFormSubmit':
        triggerBuilder += '.onFormSubmit()';
        break;
      case 'onSelectionChange':
        triggerBuilder += '.onSelectionChange()';
        break;
      default:
        throw new Error(`Unsupported spreadsheet event type: ${eventType}`);
    }

    return `
      (function() {
        try {
          const trigger = ${triggerBuilder}.create();
          ${sheetName ? `
          // Note: Sheet-specific targeting requires custom logic in the trigger function
          // The trigger function should check: if (e.source.getSheetName() !== '${escapeGasString(sheetName)}') return;
          ` : ''}
          ${range ? `
          // Note: Range-specific targeting requires custom logic in the trigger function
          // The trigger function should check if the edit is within range '${escapeGasString(range)}'
          ` : ''}
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Spreadsheet trigger created successfully',
            details: {
              eventType: '${escapeGasString(eventType)}',
              ${spreadsheetId ? `spreadsheetId: '${escapeGasString(spreadsheetId)}',` : ''}
              ${sheetName ? `sheetName: '${escapeGasString(sheetName)}',` : ''}
              ${range ? `range: '${escapeGasString(range)}',` : ''}
              note: 'Sheet/range filtering must be implemented in the trigger function'
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildFormTrigger(functionName: string, options: any): string {
    if (!options || !options.formId || !options.eventType) {
      throw new Error('formOptions with formId and eventType are required for form triggers');
    }

    const { formId, eventType } = options;
    const safeFunctionName = escapeGasString(functionName);
    let triggerBuilder = `ScriptApp.newTrigger('${safeFunctionName}').forForm(FormApp.openById('${escapeGasString(formId)}'))`;

    switch (eventType) {
      case 'onFormSubmit':
        triggerBuilder += '.onFormSubmit()';
        break;
      case 'onFormOpen':
        triggerBuilder += '.onOpen()';
        break;
      default:
        throw new Error(`Unsupported form event type: ${eventType}`);
    }

    return `
      (function() {
        try {
          const trigger = ${triggerBuilder}.create();
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Form trigger created successfully',
            details: {
              formId: '${escapeGasString(formId)}',
              eventType: '${escapeGasString(eventType)}'
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildCalendarTrigger(functionName: string, options: any): string {
    if (!options || !options.eventType) {
      throw new Error('calendarOptions with eventType are required for calendar triggers');
    }

    const { calendarId, calendarName, eventType } = options;

    const safeFunctionName = escapeGasString(functionName);
    let calendarRef;
    if (calendarId) {
      calendarRef = calendarId === 'primary'
        ? 'CalendarApp.getDefaultCalendar()'
        : `CalendarApp.getCalendarById('${escapeGasString(calendarId)}')`;
    } else if (calendarName) {
      calendarRef = `CalendarApp.getCalendarsByName('${escapeGasString(calendarName)}')[0]`;
    } else {
      calendarRef = 'CalendarApp.getDefaultCalendar()';
    }

    let triggerBuilder = `ScriptApp.newTrigger('${safeFunctionName}').forCalendar(${calendarRef})`;

    switch (eventType) {
      case 'onEventUpdated':
        triggerBuilder += '.onEventUpdated()';
        break;
      case 'onEventCreated':
        // Note: Apps Script doesn't have onEventCreated, we'll use onEventUpdated
        triggerBuilder += '.onEventUpdated()';
        break;
      case 'onEventDeleted':
        // Note: Apps Script doesn't have onEventDeleted, we'll use onEventUpdated
        triggerBuilder += '.onEventUpdated()';
        break;
      default:
        throw new Error(`Unsupported calendar event type: ${eventType}`);
    }

    return `
      (function() {
        try {
          const trigger = ${triggerBuilder}.create();
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Calendar trigger created successfully',
            details: {
              ${calendarId ? `calendarId: '${escapeGasString(calendarId)}',` : ''}
              ${calendarName ? `calendarName: '${escapeGasString(calendarName)}',` : ''}
              eventType: '${escapeGasString(eventType)}',
              ${eventType !== 'onEventUpdated' ? `note: 'Apps Script only supports onEventUpdated - your function must detect ${escapeGasString(eventType)} events manually'` : ''}
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildDocumentTrigger(functionName: string, options: any): string {
    if (!options || !options.documentId || !options.eventType) {
      throw new Error('documentOptions with documentId and eventType are required for document triggers');
    }

    const { documentId, eventType } = options;
    const safeFunctionName = escapeGasString(functionName);
    let triggerBuilder = `ScriptApp.newTrigger('${safeFunctionName}').forDocument(DocumentApp.openById('${escapeGasString(documentId)}'))`;

    switch (eventType) {
      case 'onOpen':
        triggerBuilder += '.onOpen()';
        break;
      case 'onEdit':
        // Note: Google Docs doesn't have onEdit, we'll use onOpen
        triggerBuilder += '.onOpen()';
        break;
      default:
        throw new Error(`Unsupported document event type: ${eventType}`);
    }

    return `
      (function() {
        try {
          const trigger = ${triggerBuilder}.create();
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Document trigger created successfully',
            details: {
              documentId: '${escapeGasString(documentId)}',
              eventType: '${escapeGasString(eventType)}',
              ${eventType === 'onEdit' ? `note: 'Google Docs only supports onOpen - onEdit events are not available'` : ''}
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildAddonTrigger(functionName: string, options: any): string {
    if (!options || !options.eventType) {
      throw new Error('addonOptions with eventType are required for add-on triggers');
    }

    const { eventType } = options;

    // Add-on triggers are typically handled through manifest configuration
    // But we can create simple triggers for lifecycle events
    return `
      (function() {
        try {
          // Add-on lifecycle triggers are typically configured in appsscript.json manifest
          // This creates a simple trigger that can be called manually for testing
          return {
            success: true,
            message: 'Add-on trigger configuration noted',
            details: {
              eventType: '${escapeGasString(eventType)}',
              note: 'Add-on triggers (${escapeGasString(eventType)}) should be configured in appsscript.json manifest file under "oauthScopes" and "addOns" sections'
            },
            manifestExample: {
              "addOns": {
                "common": {
                  "logoUrl": "https://example.com/logo.png",
                  "name": "Your Add-on",
                  "openLinkUrlPrefixes": ["https://example.com/"],
                  "useLocaleFromApp": true
                }
              }
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }

  private buildGmailTrigger(functionName: string, options: any): string {
    if (!options || !options.eventType) {
      throw new Error('gmailOptions with eventType are required for Gmail triggers');
    }

    const { eventType, labelName } = options;

    // Gmail add-on triggers are configured through manifest
    return `
      (function() {
        try {
          // Gmail add-on triggers are configured in appsscript.json manifest
          return {
            success: true,
            message: 'Gmail trigger configuration noted',
            details: {
              eventType: '${escapeGasString(eventType)}',
              ${labelName ? `labelName: '${escapeGasString(labelName)}',` : ''}
              note: 'Gmail triggers (${escapeGasString(eventType)}) must be configured in appsscript.json manifest under "addOns.gmail" section'
            },
            manifestExample: {
              "addOns": {
                "gmail": {
                  "name": "Your Gmail Add-on",
                  "logoUrl": "https://example.com/logo.png",
                  "contextualTriggers": [{
                    "unconditional": {},
                    "onTriggerFunction": "${escapeGasString(functionName)}"
                  }],
                  "composeTrigger": {
                    "selectActions": [{
                      "text": "Your Action",
                      "runFunction": "${escapeGasString(functionName)}"
                    }]
                  }
                }
              }
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error.toString()
          };
        }
      })()
    `;
  }
}
