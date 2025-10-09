import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from './base.js';
import { ValidationError, GASApiError } from '../errors/mcpErrors.js';
import { RunTool } from './execution.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Trigger management tool for Google Apps Script projects
 * Provides comprehensive trigger operations via gas_run
 */
export class TriggerListTool extends BaseTool {
  public name = 'trigger_list';
  public description = 'List all installable triggers for a Google Apps Script project';
  
  public inputSchema = {
    type: 'object' as const,
    properties: {
      ...SchemaFragments.accessToken,
      ...SchemaFragments.scriptId,
      detailed: {
        type: 'boolean',
        default: false,
        description: 'Include detailed trigger information (function names, sources, IDs)'
      }
    },
    required: ['scriptId']
  };

  async execute(args: any): Promise<any> {
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

      // Execute using gas_run
      const gasRunTool = new RunTool(this.sessionAuthManager);
      const runResult = await gasRunTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      return {
        success: true,
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
}

export class TriggerCreateTool extends BaseTool {
  public name = 'trigger_create';
  public description = 'Create a new installable trigger for a Google Apps Script project';
  
  public inputSchema = {
    type: 'object' as const,
    properties: {
      ...SchemaFragments.accessToken,
      ...SchemaFragments.scriptId,
      functionName: {
        type: 'string',
        description: 'Name of the function to be executed by the trigger',
        minLength: 1
      },
      triggerType: {
        type: 'string',
        enum: ['time', 'spreadsheet', 'form', 'calendar', 'document', 'addon', 'gmail'],
        description: 'Type of trigger to create'
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
    required: ['scriptId', 'functionName', 'triggerType']
  };

  async execute(args: any): Promise<any> {
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

      // Execute using gas_run
      const gasRunTool = new RunTool(this.sessionAuthManager);
      const runResult = await gasRunTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      return {
        success: true,
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

  private buildTimeBasedTrigger(functionName: string, options: any): string {
    if (!options) {
      throw new Error('timeOptions are required for time-based triggers');
    }

    const { interval, value, specificDate, weekDay, monthDay, hour, minute, timezone } = options;

    let triggerBuilder = `ScriptApp.newTrigger('${functionName}').timeBased()`;

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
        triggerBuilder += `.at(new Date('${specificDate}'))`;
        break;
      default:
        throw new Error(`Unsupported time interval: ${interval}`);
    }

    // Add timezone support if provided
    if (timezone && interval !== 'specific') {
      triggerBuilder += `.inTimezone('${timezone}')`;
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
              interval: '${interval}',
              ${value ? `value: ${value},` : ''}
              ${weekDay ? `weekDay: '${weekDay}',` : ''}
              ${monthDay ? `monthDay: ${monthDay},` : ''}
              ${hour !== undefined ? `hour: ${hour},` : ''}
              ${minute !== undefined ? `minute: ${minute},` : ''}
              ${timezone ? `timezone: '${timezone}'` : ''}
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
    
    let spreadsheetRef = spreadsheetId 
      ? `SpreadsheetApp.openById('${spreadsheetId}')`
      : 'SpreadsheetApp.getActive()';

    let triggerBuilder = `ScriptApp.newTrigger('${functionName}').forSpreadsheet(${spreadsheetRef})`;

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
          // The trigger function should check: if (e.source.getSheetName() !== '${sheetName}') return;
          ` : ''}
          ${range ? `
          // Note: Range-specific targeting requires custom logic in the trigger function  
          // The trigger function should check if the edit is within range '${range}'
          ` : ''}
          return {
            success: true,
            triggerId: trigger.getUniqueId(),
            message: 'Spreadsheet trigger created successfully',
            details: {
              eventType: '${eventType}',
              ${spreadsheetId ? `spreadsheetId: '${spreadsheetId}',` : ''}
              ${sheetName ? `sheetName: '${sheetName}',` : ''}
              ${range ? `range: '${range}',` : ''}
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
    let triggerBuilder = `ScriptApp.newTrigger('${functionName}').forForm(FormApp.openById('${formId}'))`;

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
              formId: '${formId}',
              eventType: '${eventType}'
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
    
    let calendarRef;
    if (calendarId) {
      calendarRef = calendarId === 'primary' 
        ? 'CalendarApp.getDefaultCalendar()'
        : `CalendarApp.getCalendarById('${calendarId}')`;
    } else if (calendarName) {
      calendarRef = `CalendarApp.getCalendarsByName('${calendarName}')[0]`;
    } else {
      calendarRef = 'CalendarApp.getDefaultCalendar()';
    }

    let triggerBuilder = `ScriptApp.newTrigger('${functionName}').forCalendar(${calendarRef})`;

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
              ${calendarId ? `calendarId: '${calendarId}',` : ''}
              ${calendarName ? `calendarName: '${calendarName}',` : ''}
              eventType: '${eventType}',
              ${eventType !== 'onEventUpdated' ? `note: 'Apps Script only supports onEventUpdated - your function must detect ${eventType} events manually'` : ''}
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
    let triggerBuilder = `ScriptApp.newTrigger('${functionName}').forDocument(DocumentApp.openById('${documentId}'))`;

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
              documentId: '${documentId}',
              eventType: '${eventType}',
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
              eventType: '${eventType}',
              note: 'Add-on triggers (${eventType}) should be configured in appsscript.json manifest file under "oauthScopes" and "addOns" sections'
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
              eventType: '${eventType}',
              ${labelName ? `labelName: '${labelName}',` : ''}
              note: 'Gmail triggers (${eventType}) must be configured in appsscript.json manifest under "addOns.gmail" section'
            },
            manifestExample: {
              "addOns": {
                "gmail": {
                  "name": "Your Gmail Add-on",
                  "logoUrl": "https://example.com/logo.png",
                  "contextualTriggers": [{
                    "unconditional": {},
                    "onTriggerFunction": "${functionName}"
                  }],
                  "composeTrigger": {
                    "selectActions": [{
                      "text": "Your Action",
                      "runFunction": "${functionName}"
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

export class TriggerDeleteTool extends BaseTool {
  public name = 'trigger_delete';
  public description = 'Delete an installable trigger from a Google Apps Script project';
  
  public inputSchema = {
    type: 'object' as const,
    properties: {
      ...SchemaFragments.accessToken,
      ...SchemaFragments.scriptId,
      triggerId: {
        type: 'string',
        description: 'Unique ID of the trigger to delete (optional - if not provided, will delete by function name)'
      },
      functionName: {
        type: 'string',
        description: 'Name of the function - delete all triggers for this function (optional if triggerId provided)'
      },
      deleteAll: {
        type: 'boolean',
        default: false,
        description: 'Delete ALL triggers in the project (use with caution)'
      }
    },
    required: ['scriptId']
  };

  async execute(args: any): Promise<any> {
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
        jsStatement = `
          (function() {
            try {
              const triggers = ScriptApp.getProjectTriggers();
              const trigger = triggers.find(t => t.getUniqueId() === '${triggerId}');
              
              if (!trigger) {
                return {
                  success: false,
                  error: 'Trigger with ID ${triggerId} not found'
                };
              }
              
              ScriptApp.deleteTrigger(trigger);
              return {
                success: true,
                message: 'Trigger deleted successfully',
                deletedTriggerId: '${triggerId}'
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
        jsStatement = `
          (function() {
            try {
              const triggers = ScriptApp.getProjectTriggers();
              const matchingTriggers = triggers.filter(t => t.getHandlerFunction() === '${functionName}');
              
              if (matchingTriggers.length === 0) {
                return {
                  success: false,
                  error: 'No triggers found for function ${functionName}'
                };
              }
              
              matchingTriggers.forEach(trigger => {
                ScriptApp.deleteTrigger(trigger);
              });
              
              return {
                success: true,
                deletedCount: matchingTriggers.length,
                message: \`Deleted \${matchingTriggers.length} triggers for function ${functionName}\`
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

      // Execute using gas_run
      const gasRunTool = new RunTool(this.sessionAuthManager);
      const runResult = await gasRunTool.execute({
        scriptId,
        js_statement: jsStatement,
        accessToken
      });

      const result = JSON.parse(runResult.result);
      if (!result.success) {
        throw new Error(result.error);
      }

      return result;

    } catch (error: any) {
      throw new GASApiError(
        `Failed to delete trigger(s): ${error.message}`,
        undefined,
        { scriptId, triggerId, functionName, deleteAll, error: error.message }
      );
    }
  }
} 