#pragma once
#include "BTNode.h"

UCLASS()
class UCooldownNode : public UBTNode
{
	GENERATED_BODY()
	double ReadyAt = 0.0;
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		if (Children.Num() == 0) return EBTNodeStatus::Failure;
		double Now = FPlatformTime::Seconds();
		if (Now < ReadyAt) return EBTNodeStatus::Failure;
		EBTNodeStatus Status = Children[0]->Tick(Bb);
		if (Status != EBTNodeStatus::Running)
		{
			double Duration = Parameters.Contains(TEXT("duration")) ? FCString::Atod(*Parameters[TEXT("duration")]) : 2.0;
			ReadyAt = Now + Duration;
		}
		return Status;
	}
};
