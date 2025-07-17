function _main(
  module = globalThis.__getCurrentModule(),
  exports = module.exports,
  require = globalThis.require
) {
  function testBasicLogging() {
    Logger.log("✅ Basic logging test - this message should appear in logger_output");
    console.log("❌ Console message - this should NOT appear in logger_output");
    return "Basic logging test completed successfully";
  }

  function testMultipleLogMessages() {
    Logger.log("📝 Message 1: Testing multiple log messages");
    Logger.log("📝 Message 2: Second log message");
    Logger.log("📝 Message 3: Third log message");
    return "Multiple log messages test completed";
  }

  function testLogWithData() {
    const timestamp = new Date().toISOString();
    const calculation = 42 * 2;
    
    Logger.log("🕐 Current timestamp: " + timestamp);
    Logger.log("🔢 Calculation result: " + calculation);
    Logger.log("📊 Data test completed");
    
    return {
      timestamp: timestamp,
      calculation: calculation,
      status: "success"
    };
  }

  function testErrorLogging() {
    Logger.log("🚨 Starting error test");
    
    try {
      throw new Error("This is a test error for logging");
    } catch (error) {
      Logger.log("❗ Caught error: " + error.message);
      Logger.log("✅ Error handling test completed");
      return "Error test completed - error was caught and logged";
    }
  }

  // Export all test functions
  return {
    testBasicLogging,
    testMultipleLogMessages,
    testLogWithData,
    testErrorLogging
  };
}

__defineModule__(_main);