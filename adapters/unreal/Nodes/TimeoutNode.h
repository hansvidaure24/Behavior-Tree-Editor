#pragma once
#include "BTNode.h"

UCLASS()
class UTimeoutNode : public UBTNode
{
	GENERATED_BODY()
	double StartTime = -1.0;
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		if (Children.Num() == 0) return EBTNodeStatus::Failure;
		double Now = FPlatformTime::Seconds();
		if (StartTime < 0) StartTime = Now;
		double Seconds = Parameters.Contains(TEXT("seconds")) ? FCString::Atod(*Parameters[TEXT("seconds")]) : 5.0;
		if (Now - StartTime > Seconds) { StartTime = -1.0; return EBTNodeStatus::Failure; }
		EBTNodeStatus Status = Children[0]->Tick(Bb);
		if (Status != EBTNodeStatus::Running) StartTime = -1.0;
		return Status;
	}
};
