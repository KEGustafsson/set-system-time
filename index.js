const util = require('util')

module.exports = function (app) {
  // Enhanced logging with proper object handling
  const logError = (err) => {
    console.error('=== DEBUG ERROR LOG ===')
    console.error('Type:', typeof err)
    console.error('Constructor:', err && err.constructor && err.constructor.name)
    console.error('Is Error:', err instanceof Error)
    
    if (err instanceof Error) {
      console.error('Error message:', err.message)
      console.error('Error stack:', err.stack)
    } else if (err && typeof err === 'object') {
      try {
        console.error('Object keys:', Object.keys(err))
        console.error('Object stringified:', JSON.stringify(err, null, 2))
      } catch (e) {
        console.error('Cannot stringify object (circular reference?)')
        console.error('Object toString:', Object.prototype.toString.call(err))
        console.error('Using util.inspect:', util.inspect(err, { depth: null, colors: false }))
        // Try to extract useful info
        if (err.message) console.error('Has message:', err.message)
        if (err.code) console.error('Has code:', err.code)
        if (err.signal) console.error('Has signal:', err.signal)
      }
    } else {
      console.error('Value:', String(err))
    }
    console.error('=== END DEBUG ===')
  }
  
  const debug = (msg) => {
    if (typeof msg === 'object' && msg !== null) {
      if (msg instanceof Error) {
        console.log('Debug Error:', msg.message)
      } else {
        try {
          console.log('Debug Object:', JSON.stringify(msg, null, 2))
        } catch (e) {
          console.log('Debug Object (util.inspect):', util.inspect(msg, { depth: null, colors: false }))
        }
      }
    } else {
      console.log('Debug:', String(msg))
    }
  }
  
  // Check what app.error looks like for debugging
  console.log('app.error type:', typeof app.error)
  if (app.error) {
    console.log('Using app.error function')
  } else {
    console.log('Using fallback logError function')
  }
  
  // Use app.error if available, otherwise use our enhanced logError
  const finalLogError = app.error || logError
  const finalDebug = app.debug || debug
  
  var plugin = {
    unsubscribes: []
  }
  plugin.id = 'set-system-time'
  plugin.name = 'Set System Time'
  plugin.description =
    'Plugin that sets the system date & time from navigation.datetime delta messages'
  plugin.schema = () => ({
    title: 'Set System Time with sudo',
    type: 'object',
    properties: {
      interval: {
        type: 'number',
        title: 'Interval between updates in seconds (0 is once upon plugin start when datetime received)',
        default: 0
      },
      sudo: {
        type: 'boolean',
        title: 'Use sudo when setting the time',
        default: true
      },
      preferNetworkTime: {
        type: 'boolean',
        title: 'Set system time only if no other source are available ( Only chrony detected )',
        default: true
      }
    }
  })
  
  const SUDO_NOT_AVAILABLE = 'SUDO_NOT_AVAILABLE'
  let count = 0
  let lastMessage = ''
  
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
  }
  
  plugin.start = function (options) {
    let stream = app.streambundle.getSelfStream('navigation.datetime')
    if (options && options.interval > 0) {
      stream = stream.debounceImmediate(options.interval * 1000)
    } else {
      stream = stream.take(1)
    }
    
    plugin.unsubscribes.push(
      stream.onValue(function (datetime) {
        var child
        if (process.platform == 'win32') {
          const errorMsg = "Set-system-time supports only linux-like os's"
          console.error(errorMsg)
          finalLogError(errorMsg)
        } else {
          if (!plugin.useNetworkTime(options)) {
            const useSudo = typeof options.sudo === 'undefined' || options.sudo
            const setDate = `date --iso-8601 -u -s "${datetime}"`
            const command = useSudo
              ? `if sudo -n date &> /dev/null ; then sudo ${setDate} ; else exit 3 ; fi`
              : setDate
            
            console.log('Executing command:', command)
            child = require('child_process').spawn('sh', ['-c', command])
            
            child.on('exit', (code, signal) => {
              console.log('Child process exit - code:', code, 'signal:', signal)
              if (code === 0) {
                count++
                lastMessage = 'System time set to ' + datetime
                finalDebug(lastMessage)
              } else if (code === 3) {
                lastMessage = 'Passwordless sudo not available, can not set system time'
                finalLogError(lastMessage)
              } else {
                lastMessage = `Command failed with exit code: ${code}${signal ? ', signal: ' + signal : ''}`
                finalLogError(lastMessage)
              }
            })
            
            child.stderr.on('data', function (data) {
              console.log('stderr data type:', typeof data)
              console.log('stderr data constructor:', data.constructor.name)
              const dataStr = data.toString().trim()
              lastMessage = `stderr: ${dataStr}`
              console.log('Calling finalLogError with:', lastMessage)
              finalLogError(lastMessage)
            })
            
            child.stdout.on('data', function (data) {
              const dataStr = data.toString().trim()
              console.log('stdout:', dataStr)
              finalDebug(`stdout: ${dataStr}`)
            })
            
            child.on('error', function (error) {
              console.log('spawn error type:', typeof error)
              console.log('spawn error constructor:', error.constructor.name)
              lastMessage = `Failed to spawn process: ${error.message}`
              finalLogError(lastMessage)
            })
          } else {
            finalDebug('Network time source detected, skipping system time set')
          }
        }
      })
    )
  }
  
  plugin.useNetworkTime = (options) => {
    if (typeof options.preferNetworkTime !== 'undefined' && options.preferNetworkTime === true) {
      const chronyCmd = "chronyc sources 2> /dev/null | cut -c2 | grep -ce '-\\|\\*'";
      try {
        const validSources = require('child_process').execSync(chronyCmd, { timeout: 500 });
        const count = parseInt(validSources.toString().trim(), 10);
        console.log('chrony valid sources count:', count)
        return count > 0;
      } catch (e) {
        finalDebug(`chrony check failed: ${e.message}`)
        return false
      }
    }
    return false
  }
  
  plugin.stop = function () {
    plugin.unsubscribes.forEach(f => f())
  }
  
  return plugin
}
