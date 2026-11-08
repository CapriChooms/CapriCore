// Build-time only: import the Windows UI Automation type library, no app access.
using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

class ImportNotify : ITypeLibImporterNotifySink {
    public void ReportEvent(ImporterEventKind kind,int code,string message) { }
    public Assembly ResolveRef(object typeLib) { throw new InvalidOperationException("Unexpected external UI Automation type library reference."); }
}
class ExportAutomation {
    [DllImport("oleaut32.dll",CharSet=CharSet.Unicode,PreserveSig=false)]
    static extern void LoadTypeLibEx(string file,int kind,out ITypeLib library);
    static void Main(string[] args) {
        ITypeLib library;LoadTypeLibEx(args[0],2,out library);
        var assembly=new TypeLibConverter().ConvertTypeLibToAssembly(library,args[1],TypeLibImporterFlags.None,new ImportNotify(),null,null,"UIAutomationClient",null);
        assembly.Save(System.IO.Path.GetFileName(args[1]));
    }
}
